import { Queue } from "bullmq";
import Redis from "ioredis";

// Use port 6380 based on our docker-compose.yml configuration
const redisOptions = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6380", 10),
    maxRetriesPerRequest: null,
};

export const connection = new Redis(redisOptions);

export const QUEUE_NAME = "url-processing";

export const urlQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
    },
});

export async function enqueueTasks(tasks: { taskId: string; url: string; jobId: string }[]) {
    const jobs = tasks.map((task) => ({
        name: "process-url",
        data: task,
        opts: {
            jobId: task.taskId, // Prevent duplicate processing
        },
    }));

    return urlQueue.addBulk(jobs);
}
