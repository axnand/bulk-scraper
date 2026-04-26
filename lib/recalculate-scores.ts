import { prisma } from "@/lib/prisma";
import { getEffectiveRules } from "@/lib/analyzer";

export async function recalculateScoresForRequisition(requisitionId: string, config: any) {
  try {
    console.log(`[RecalculateScores] Starting for requisition ${requisitionId}`);
    
    // 1. Fetch all AnalysisRecords for the jobs under this requisition
    // Wait, AnalysisRecord is linked to CandidateProfile, not Requisition or Job.
    // However, it has a jobTitle/jobDescription. Or we can find CandidateProfiles that have Tasks for Jobs of this Requisition?
    // Let's trace from Requisition -> Job -> Task -> CandidateProfile -> AnalysisRecord
    
    // Find all Tasks for this Requisition
    const tasks = await prisma.task.findMany({
      where: {
        job: { requisitionId },
        status: "DONE",
      },
      select: {
        url: true, // We can match linkedinUrl
      }
    });

    if (tasks.length === 0) return;

    const urls = Array.from(new Set(tasks.map(t => t.url)));

    // Fetch AnalysisRecords matching these URLs and the requisition's jobDescription/jobTitle? 
    // Wait, a candidate might be in multiple requisitions, but AnalysisRecord is created *per analysis*.
    // And AnalysisRecord doesn't have a requisitionId. 
    // Let's just find AnalysisRecords that have `scoringConfig` containing the same job rules?
    // Actually, AnalysisRecord has `jobDescription` and `jobTitle`.
    // It's safer to match by `linkedinUrl` AND `jobDescription` (or `jobTitle`) since those are unique to the requisition/job run.
    
    const records = await prisma.analysisRecord.findMany({
      where: {
        linkedinUrl: { in: urls },
        // To be safe, we can match jobDescription to Requisition's JD
        jobDescription: config.jobDescription,
      }
    });

    console.log(`[RecalculateScores] Found ${records.length} records to update`);

    const effectiveRules = getEffectiveRules({
      scoringRules: config.scoringRules,
      customScoringRules: config.customScoringRules,
      builtInRuleDescriptions: config.builtInRuleDescriptions,
      ruleDefinitions: config.ruleDefinitions,
    });

    const activeRules = effectiveRules.filter(r => r.enabled);
    const maxScore = activeRules.reduce((sum, rule) => {
      const maxP = Math.max(0, ...rule.scoreParameters.map(p => p.maxPoints));
      return sum + maxP;
    }, 0);

    for (const record of records) {
      if (!record.analysisData) continue;
      
      let data: any;
      try {
        data = JSON.parse(record.analysisData);
      } catch {
        continue;
      }

      const scoring = data.scoring || {};
      
      let totalScore = 0;
      for (const rule of activeRules) {
        let bestRuleScore = 0;
        for (const p of rule.scoreParameters) {
          const val = scoring[p.key];
          if (typeof val === "number" && val > bestRuleScore) {
            bestRuleScore = val;
          }
        }
        totalScore += bestRuleScore;
      }

      const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
      let recommendation = "Not a Fit";
      if (scorePercent >= 70) recommendation = "Strong Fit";
      else if (scorePercent >= 40) recommendation = "Moderate Fit";

      // Update the analysisData JSON to reflect new totals (so the UI reads it correctly)
      data.totalScore = totalScore;
      data.maxScore = maxScore;
      data.scorePercent = scorePercent;
      data.recommendation = recommendation;
      data.enabledRules = config.scoringRules; // Sync the rules back so UI shows what was active

      await prisma.analysisRecord.update({
        where: { id: record.id },
        data: {
          totalScore,
          maxScore,
          scorePercent,
          recommendation,
          analysisData: JSON.stringify(data),
          scoringConfig: JSON.stringify({
            scoringRules: config.scoringRules,
            customScoringRules: config.customScoringRules,
            aiModel: config.aiModel,
            customPrompt: config.customPrompt,
          }),
        }
      });
    }

    console.log(`[RecalculateScores] Completed for ${requisitionId}`);
  } catch (error) {
    console.error(`[RecalculateScores] Error:`, error);
  }
}
