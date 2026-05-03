import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";
import {
  buildBulkExportData,
  exportToSheet,
  SheetColumn,
  ScoringRulesConfig,
} from "@/lib/sheets";
import XLSXStyle from "xlsx-js-style";

/**
 * POST /api/requisitions/[requisitionId]/export
 *
 * Exports analysed candidates aggregated across every run under a requisition.
 * Body (all optional):
 *   sheetWebAppUrl?: string
 *   taskIds?: string[]
 *   minScoreThreshold?: number
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);
    const body = await req.json().catch(() => ({}));
    const taskIds: string[] | undefined = body.taskIds;

    const requisition = await prisma.requisition.findUnique({ where: { id: requisitionId } });
    if (!requisition) {
      return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
    }

    const config = requisition.config ? JSON.parse(requisition.config) : {};
    const threshold =
      body.minScoreThreshold != null
        ? Number(body.minScoreThreshold)
        : Number(config.minScoreThreshold) || 0;
    const scoringRules: ScoringRulesConfig = config.scoringRules || {};
    const jdTitle = config.jdTitle || requisition.title || `Requisition ${requisitionId.slice(0, 8)}`;

    const where: any = {
      job: { requisitionId },
      analysisResult: { not: null },
      OR: [{ status: "DONE" }, { status: "CANCELLED" }],
    };
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
        analysisResult: JSON.parse(t.analysisResult as string),
      }))
      .filter((t) =>
        taskIds && taskIds.length > 0
          ? true
          : (t.analysisResult.scorePercent ?? 0) >= threshold
      );

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: `No profiles meet the ${threshold}% score threshold` },
        { status: 400 }
      );
    }

    const exportTitle = `${jdTitle} - Export`;
    const { columns, rows } = buildBulkExportData(parsed, exportTitle, scoringRules);

    const sheetUrl: string = body.sheetWebAppUrl || "";

    if (sheetUrl) {
      let exported = 0;
      let failed = 0;
      for (const rowData of rows) {
        const res = await exportToSheet(sheetUrl, { jdTitle: exportTitle, columns, rowData });
        if (res.success) exported++;
        else failed++;
      }
      return NextResponse.json({
        mode: "sheet",
        total: rows.length,
        exported,
        failed,
        tabName: exportTitle,
      });
    }

    const xlsxBuf = buildStyledXlsx(columns, rows, exportTitle);
    const filename = `${jdTitle.replaceAll(/[^a-zA-Z0-9 -]/g, "")}_export.xlsx`;

    return new NextResponse(xlsxBuf as any, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[Requisitions] Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

const YELLOW = "FFD966";
const ORANGE_PARENT = "F6B26B";
const ORANGE_CHILD = "F9CB9C";
const DATA_ALT = "FFF9F0";
const BORDER_COLOR = "D0D0D0";

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
      font: {
        bold: opts.bold ?? false,
        sz: opts.sz ?? 10,
        color: { rgb: opts.fontColor ?? "000000" },
      },
      alignment: {
        horizontal: opts.align ?? "center",
        vertical: "center",
        wrapText: true,
      },
      border: borderAll(),
    },
  };
}

function buildStyledXlsx(
  columns: SheetColumn[],
  rows: Record<string, any>[],
  sheetName: string
): Buffer {
  const numCols = columns.length;
  const keys = columns.map((c) => c.key);

  type GroupSpan = { name: string; start: number; end: number };
  const groupSpans: GroupSpan[] = [];
  const ungroupedCols: number[] = [];

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

  const row1: any[] = columns.map((col) => {
    if (!col.group) return makeCell(col.label, YELLOW, { bold: true, sz: 10 });
    return makeCell("", ORANGE_PARENT, { bold: true, sz: 10 });
  });

  for (const g of groupSpans) {
    row1[g.start] = makeCell(g.name, ORANGE_PARENT, { bold: true, sz: 10 });
  }

  const row2: any[] = columns.map((col) => {
    if (!col.group) return makeCell("", YELLOW, { sz: 10 });
    return makeCell(col.label, ORANGE_CHILD, { bold: true, sz: 10 });
  });

  const dataRows: any[][] = rows.map((row, ri) => {
    const bg = ri % 2 === 0 ? "FFFFFF" : DATA_ALT;
    return keys.map((k) => {
      const v = row[k] ?? "";
      const align = typeof v === "number" ? "center" : "left";
      return makeCell(v, bg, { bold: false, align });
    });
  });

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

  const merges: any[] = [];
  for (const colIdx of ungroupedCols) {
    merges.push({ s: { r: 0, c: colIdx }, e: { r: 1, c: colIdx } });
  }
  for (const g of groupSpans) {
    if (g.end > g.start) {
      merges.push({ s: { r: 0, c: g.start }, e: { r: 0, c: g.end } });
    }
  }
  ws["!merges"] = merges;
  ws["!freeze"] = { xSplit: 3, ySplit: 2 };
  ws["!cols"] = columns.map((c) => ({
    wch: Math.max(c.label?.length ?? 0, c.group?.length ?? 0, 10) + 3,
  }));
  ws["!rows"] = [{ hpt: 24 }, { hpt: 36 }];

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  return XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" });
}
