import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildBulkExportData,
  exportToSheet,
  SheetColumn,
  ScoringRulesConfig,
} from "@/lib/sheets";
// xlsx-js-style is a drop-in fork of xlsx that supports cell-level styling
import XLSXStyle from "xlsx-js-style";

/**
 * POST /api/jobs/[jobId]/export
 *
 * Bulk-exports analysed profiles for a job.
 *  - body.sheetWebAppUrl → push rows to Google Sheet (new tab)
 *  - otherwise           → return styled XLSX file (matches Google Sheet format exactly)
 *
 * Body (all optional):
 *   sheetWebAppUrl?: string
 *   taskIds?: string[]          — export only these specific tasks
 *   minScoreThreshold?: number  — 0-100, default 0 = all
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const threshold = Number(body.minScoreThreshold) || 0;
    const taskIds: string[] | undefined = body.taskIds;

    // ── 1. Fetch job + config ──────────────────────────────────────────
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const config = job.config ? JSON.parse(job.config) : {};
    const scoringRules: ScoringRulesConfig = config.scoringRules || {};
    const jdTitle = config.jdTitle || `Job ${jobId.slice(0, 8)}`;

    // ── 2. Fetch DONE tasks with analysis ─────────────────────────────
    const where: any = { jobId, status: "DONE", analysisResult: { not: null } };
    if (taskIds && taskIds.length > 0) where.id = { in: taskIds };

    const tasks = await prisma.task.findMany({
      where,
      select: { url: true, analysisResult: true },
      orderBy: { createdAt: "asc" },
    });

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: "No analysed profiles to export" },
        { status: 400 }
      );
    }

    const parsed = tasks
      .map((t) => ({
        url: t.url,
        analysisResult: JSON.parse(t.analysisResult!),
      }))
      .filter((t) => (t.analysisResult.scorePercent ?? 0) >= threshold);

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: `No profiles meet the ${threshold}% score threshold` },
        { status: 400 }
      );
    }

    // ── 3. Build column + row data ─────────────────────────────────────
    const exportTitle = `${jdTitle} - Export`;
    const { columns, rows } = buildBulkExportData(parsed, exportTitle, scoringRules);

    const sheetUrl: string = body.sheetWebAppUrl || "";

    // ── 4A. Google Sheet export ────────────────────────────────────────
    if (sheetUrl) {
      let exported = 0;
      let failed = 0;
      for (const rowData of rows) {
        const res = await exportToSheet(sheetUrl, { jdTitle: exportTitle, columns, rowData });
        if (res.success) exported++;
        else failed++;
      }
      return NextResponse.json({ mode: "sheet", total: rows.length, exported, failed, tabName: exportTitle });
    }

    // ── 4B. Styled XLSX download ───────────────────────────────────────
    const xlsxBuf = buildStyledXlsx(columns, rows, exportTitle);
    const filename = `${jdTitle.replaceAll(/[^a-zA-Z0-9 -]/g, "")}_export.xlsx`;

    return new NextResponse(xlsxBuf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[Export] Error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

// ── Exact color palette from the Google Apps Script ────────────────────────
// Yellow  (#FFD966) = ungrouped columns (Date, Name, LinkedIn, etc.)
// Orange  (#F6B26B) = group parent header row (Growth, Graduation, etc.)
// L.Orange(#F9CB9C) = group child labels row (Same Company, Tier 1, etc.)
const YELLOW       = "FFD966";
const ORANGE_PARENT = "F6B26B";
const ORANGE_CHILD  = "F9CB9C";
const DATA_ALT      = "FFF9F0"; // very light orange tint for alternating data rows
const BORDER_COLOR  = "D0D0D0";

function borderAll() {
  const side = { style: "thin", color: { rgb: BORDER_COLOR } };
  return { top: side, bottom: side, left: side, right: side };
}

function makeCell(value: any, bg: string, opts: Record<string, any> = {}): any {
  const isNum = typeof value === "number";
  return {
    v: value ?? "",
    t: isNum ? "n" : "s",
    s: {
      fill: { fgColor: { rgb: bg } },
      font: { bold: opts.bold ?? false, sz: opts.sz ?? 10, color: { rgb: opts.fontColor ?? "000000" } },
      alignment: {
        horizontal: opts.align ?? "center",
        vertical: "center",
        wrapText: true,
      },
      border: borderAll(),
    },
  };
}

/**
 * Build an XLSX that exactly matches the Google Sheet header structure:
 *
 * Row 1: Ungrouped columns → label, yellow bg, merged vertically with row 2
 *        Grouped columns   → group name, orange bg, merged horizontally across the group
 * Row 2: Ungrouped columns → empty (covered by vertical merge from row 1)
 *        Grouped columns   → sub-label, light-orange bg
 * Row 3+: Data rows (alternating white / very-light-orange)
 */
function buildStyledXlsx(
  columns: SheetColumn[],
  rows: Record<string, any>[],
  sheetName: string
): Buffer {
  const numCols = columns.length;
  const keys    = columns.map((c) => c.key);

  // ── Compute group spans (for horizontal merges in row 1) ──────────
  type GroupSpan = { name: string; start: number; end: number };
  const groupSpans: GroupSpan[] = [];
  let   ungroupedCols: number[] = []; // 0-based column indices

  let ci = 0;
  while (ci < columns.length) {
    const col = columns[ci];
    if (col.group) {
      const start = ci;
      while (ci < columns.length && columns[ci].group === col.group) ci++;
      groupSpans.push({ name: col.group, start, end: ci - 1 });
    } else {
      ungroupedCols.push(ci);
      ci++;
    }
  }

  // ── Build row 1 cells ─────────────────────────────────────────────
  // For ungrouped: label in row 1 (yellow, bold)
  // For grouped:   group name in first cell of group (orange parent, bold), empty elsewhere
  const row1: any[] = columns.map((col) => {
    if (!col.group) {
      return makeCell(col.label, YELLOW, { bold: true, sz: 10 });
    }
    return makeCell("", ORANGE_PARENT, { bold: true, sz: 10 }); // filled in below for first-of-group
  });

  // Fill group names into the first cell of each group span
  for (const g of groupSpans) {
    row1[g.start] = makeCell(g.name, ORANGE_PARENT, { bold: true, sz: 10 });
  }

  // ── Build row 2 cells ─────────────────────────────────────────────
  // For ungrouped: empty cell (will be covered by vertical merge from row 1)
  // For grouped:   sub-label (light orange)
  const row2: any[] = columns.map((col) => {
    if (!col.group) {
      return makeCell("", YELLOW, { sz: 10 });
    }
    return makeCell(col.label, ORANGE_CHILD, { bold: true, sz: 10 });
  });

  // ── Build data rows ───────────────────────────────────────────────
  const dataRows: any[][] = rows.map((row, ri) => {
    const bg = ri % 2 === 0 ? "FFFFFF" : DATA_ALT;
    return keys.map((k) => {
      const v = row[k] ?? "";
      const align = typeof v === "number" ? "center" : "left";
      return makeCell(v, bg, { bold: false, align });
    });
  });

  // ── Assemble worksheet ────────────────────────────────────────────
  const allRowArrays = [row1, row2, ...dataRows];
  const ws: any = {};

  for (let ri = 0; ri < allRowArrays.length; ri++) {
    for (let ci2 = 0; ci2 < numCols; ci2++) {
      ws[XLSXStyle.utils.encode_cell({ r: ri, c: ci2 })] = allRowArrays[ri][ci2];
    }
  }

  ws["!ref"] = XLSXStyle.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: allRowArrays.length - 1, c: numCols - 1 },
  });

  // ── Merges ────────────────────────────────────────────────────────
  const merges: any[] = [];

  // Ungrouped: merge row 1 + row 2 vertically
  for (const colIdx of ungroupedCols) {
    merges.push({ s: { r: 0, c: colIdx }, e: { r: 1, c: colIdx } });
  }

  // Grouped: merge group header horizontally in row 1
  for (const g of groupSpans) {
    if (g.end > g.start) {
      merges.push({ s: { r: 0, c: g.start }, e: { r: 0, c: g.end } });
    }
  }

  ws["!merges"] = merges;

  // Freeze first 2 rows + first 3 columns (Date, Name, LinkedIn) — matches Apps Script
  ws["!freeze"] = { xSplit: 3, ySplit: 2 };

  // Column widths
  ws["!cols"] = columns.map((c) => ({
    wch: Math.max((c.label?.length ?? 0), (c.group?.length ?? 0), 10) + 3,
  }));

  // Row heights
  ws["!rows"] = [{ hpt: 24 }, { hpt: 36 }];

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  return XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" });
}
