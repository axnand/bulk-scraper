/**
 * Quick test: runs the analyzer with mock LinkedIn profile data
 * to verify OpenAI integration works end-to-end.
 *
 * Usage: npx tsx --env-file=.env scripts/test-analyzer.ts
 */
import { analyzeProfile } from "../lib/analyzer";
import { prisma } from "../lib/prisma";

const mockProfile = {
  first_name: "Manikandan",
  last_name: "S",
  headline: "Senior Software Engineer at TCS | Full Stack Developer",
  location: "Chennai, Tamil Nadu, India",
  summary: "Experienced full-stack developer with 5+ years in React, Node.js, and cloud technologies.",
  work_experience: [
    {
      position: "Senior Software Engineer",
      company: "Tata Consultancy Services",
      start: "1/1/2021",
      end: null,
      description: "Leading a team of 5 developers building enterprise B2B SaaS solutions.",
    },
    {
      position: "Software Engineer",
      company: "Tata Consultancy Services",
      start: "6/1/2019",
      end: "12/1/2020",
      description: "Built REST APIs and React dashboards for client projects.",
    },
    {
      position: "Software Developer Intern",
      company: "Zoho Corp",
      start: "1/1/2019",
      end: "5/1/2019",
      description: "Internship building CRM plugins.",
    },
  ],
  education: [
    {
      school: "Anna University",
      degree: "B.Tech in Computer Science",
      field: "Computer Science",
    },
  ],
  skills: [
    { name: "React" }, { name: "Node.js" }, { name: "TypeScript" },
    { name: "AWS" }, { name: "Python" }, { name: "MongoDB" },
  ],
  certifications: [],
};

const config = {
  jobDescription: `Role: Sales Development Representative - Africa
Designation: SDR
Experience: 0-3 Years
Location: Kenya/Nigeria
Skills Required: Sales, CRM, B2B Sales, Cold Calling, Lead Generation, Salesforce
Education: Graduation with MBA preferred`,
  scoringRules: {
    stability: true, growth: true, graduation: true,
    companyType: true, mba: true, skillMatch: true, location: true,
  },
  customScoringRules: [],
  aiModel: "gpt-4.1-mini",
};

async function main() {
  console.log("🧪 Testing analyzer with mock profile data...\n");

  try {
    const result = await analyzeProfile(mockProfile, config);
    console.log("\n✅ Analysis succeeded!");
    console.log(`Score: ${result.totalScore}/${result.maxScore} (${result.scorePercent}%) → ${result.recommendation}`);
    console.log(`Strengths: ${result.strengths.join(", ")}`);
    console.log(`Gaps: ${result.gaps.join(", ")}`);
    console.log(`Flags: ${result.flags.length > 0 ? result.flags.join(", ") : "(none)"}`);

    // Insert into the latest job's task so user can see it on the UI
    const latestTask = await prisma.task.findFirst({
      where: { jobId: "cmn8q295p0001e3yfi6itsenk" },
      orderBy: { createdAt: "desc" },
    });

    if (latestTask) {
      await prisma.task.update({
        where: { id: latestTask.id },
        data: {
          status: "DONE",
          result: JSON.stringify(mockProfile),
          analysisResult: JSON.stringify(result),
          errorMessage: null,
        },
      });
      await prisma.job.update({
        where: { id: "cmn8q295p0001e3yfi6itsenk" },
        data: { status: "COMPLETED", processedCount: 1, successCount: 1, failedCount: 0 },
      });
      console.log("\n📝 Inserted into DB — check the results page at http://localhost:3000/jobs/cmn8q295p0001e3yfi6itsenk");
    } else {
      console.log("\n(No task found to insert into — just displaying result above)");
    }
  } catch (err: any) {
    console.error("❌ Analysis failed:", err.message);
  }

  process.exit(0);
}

main();
