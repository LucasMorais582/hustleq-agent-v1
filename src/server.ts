import { createApp } from "./app.js";
import "./mvp/jobs/index.js";
import { startQueue } from "./mvp/jobs/queue.js";

const app = createApp();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);
});

// The worker runs in the same process for now. JOBS_WORKER=off turns it off (e.g. for a web-only service).
if (process.env.JOBS_WORKER !== "off" && process.env.MVP_DATABASE_URL) {
  startQueue().then(
    () => console.log("[jobs] queue started"),
    (error) => console.error("[jobs] queue failed to start", error)
  );
}
