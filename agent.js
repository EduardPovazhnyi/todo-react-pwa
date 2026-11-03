// agent.js — a small, rule-based deployment agent for a React PWA.
//
// Loop: OBSERVE the result of each step -> DECIDE what to do next -> ACT by
// calling a tool. Every tool is deliberately "dumb": it does one job and
// returns { ok, reason }. Only runAgent() makes decisions.
//
// Run by .github/workflows/deploy-agent.yml on every push to main.
// Needs Node 18+ (for the built-in fetch) and the Vercel CLI on the PATH.

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration (set as GitHub secrets / repository variables in the workflow)
// ---------------------------------------------------------------------------
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
// Your public production address, e.g. https://my-todo-app.vercel.app
const PRODUCTION_URL = (process.env.PRODUCTION_URL || "").replace(/\/+$/, "");
// The file the health check reads. Must contain {"status":"ok"}.
const HEALTH_PATH = process.env.HEALTH_PATH || "/health.json";

// Where `vercel build` writes the static site, and the PWA files it must contain.
// (Create React App PWA template. For Vite + vite-plugin-pwa use
//  "manifest.webmanifest" and "sw.js" instead.)
const OUTPUT_DIR = path.join(".vercel", "output", "static");
const PWA_FILES = ["manifest.json", "service-worker.js", "health.json"];

const HEALTH_ATTEMPTS = 3; // propagation can take a few seconds...
const HEALTH_WAIT_MS = 5000; // ...so retry before deciding it's a real failure

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(message) {
  console.log(`[agent ${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs a shell command. Returns { ok, output } instead of throwing, so the
// agent can observe a failure and decide what to do about it. Captures both
// stdout and stderr — the Vercel CLI prints a lot of its output to stderr.
function run(command, extraEnv = {}) {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
    maxBuffer: 50 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (output) console.log(output);
  return { ok: result.status === 0, output };
}

function vercel(args) {
  return run(`vercel ${args} --scope=${process.env.VERCEL_ORG_ID} --token=${VERCEL_TOKEN}`);
}

// ---------------------------------------------------------------------------
// Tools — each does ONE thing and reports back { ok, reason }
// ---------------------------------------------------------------------------
function notify(message) {
  // Stretch goal: send this to a Slack/Discord webhook as well.
  log(`NOTIFY: ${message}`);
}

function runTests() {
  log("Tool: runTests()");
  // --watchAll=false stops Jest waiting for input; --passWithNoTests stops an
  // app with no test files from failing.
  const result = run("npm test -- --watchAll=false --passWithNoTests", {
    CI: "true",
  });
  return result.ok ? { ok: true } : { ok: false, reason: "tests failed" };
}

function buildApp() {
  log("Tool: buildApp()");
  // Pull the project's settings from Vercel, then build ON THIS RUNNER, so the
  // files we check are exactly the files we deploy.
  const pulled = vercel("pull --yes --environment=production");
  if (!pulled.ok) return { ok: false, reason: "could not pull Vercel project settings" };

  // Create React App treats lint warnings as errors when CI=true. We let
  // warnings through here — Code Challenge 1 adds a proper lintCode() step.
  const built = run(`vercel build --prod --token=${VERCEL_TOKEN}`, { CI: "false" });
  return built.ok ? { ok: true } : { ok: false, reason: "build failed" };
}

function checkPWA() {
  log("Tool: checkPWA()");
  const missing = PWA_FILES.filter((f) => !fs.existsSync(path.join(OUTPUT_DIR, f)));
  return missing.length === 0
    ? { ok: true }
    : { ok: false, reason: `missing from build: ${missing.join(", ")}` };
}

// Which deployment is live right now? We need its ID to roll back to it later.
function getCurrentProduction() {
  log("Tool: getCurrentProduction()");
  const result = vercel(`inspect ${PRODUCTION_URL}`);
  const match = result.ok && result.output.match(/dpl_[A-Za-z0-9]+/);
  return match ? { ok: true, id: match[0] } : { ok: false, reason: "no live deployment yet" };
}

function deploy() {
  log("Tool: deploy()");
  // Upload the prebuilt output as a production deployment, but don't make it
  // live yet (--skip-domain). promote() is the step that switches traffic.
  const result = vercel("deploy --prebuilt --prod --skip-domain --yes");
  const urls = result.ok ? result.output.match(/https:\/\/\S+\.vercel\.app/g) : null;
  return urls
    ? { ok: true, url: urls[urls.length - 1] }
    : { ok: false, reason: "deploy command failed" };
}

function promote(url) {
  log(`Tool: promote(${url})`);
  // Points the production domain at the new deployment. This also undoes any
  // earlier rollback, so future deployments can go live again.
  const result = vercel(`promote ${url} --yes`);
  return result.ok ? { ok: true } : { ok: false, reason: "promote failed" };
}

async function checkHealth(url) {
  log(`Tool: checkHealth(${url})`);
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
    try {
      const page = await fetch(`${url}/`, { cache: "no-store" });
      const health = await fetch(`${url}${HEALTH_PATH}?t=${Date.now()}`, { cache: "no-store" });
      const body = health.ok ? await health.json().catch(() => ({})) : {};
      if (page.status === 200 && body.status === "ok") return { ok: true };
      log(`  attempt ${attempt}: page ${page.status}, health ${health.status} ${JSON.stringify(body)}`);
    } catch (err) {
      log(`  attempt ${attempt}: request failed (${err.message})`);
    }
    if (attempt < HEALTH_ATTEMPTS) await sleep(HEALTH_WAIT_MS);
  }
  return { ok: false, reason: "health check failed" };
}

function rollback(deploymentId) {
  log(`Tool: rollback(${deploymentId})`);
  // Vercel's own Instant Rollback. It needs to be told WHICH deployment to go
  // back to — `vercel rollback` with no argument only prints the status.
  const result = vercel(`rollback ${deploymentId} --yes`);
  return result.ok ? { ok: true } : { ok: false, reason: "rollback command failed" };
}

// ---------------------------------------------------------------------------
// The agent loop — the only place decisions are made
// ---------------------------------------------------------------------------
async function runAgent() {
  const MAX_ROLLBACKS = 1; // guardrail: never roll back more than once per run
  let rollbacks = 0;

  log("=== Agent started ===");
  if (!VERCEL_TOKEN || !PRODUCTION_URL) {
    notify("VERCEL_TOKEN or PRODUCTION_URL is not set. Stopping before doing anything.");
    return "BLOCKED";
  }

  // OBSERVE -> DECIDE -> ACT, one gate at a time.
  for (const tool of [runTests, buildApp, checkPWA]) {
    const result = tool();
    if (!result.ok) {
      notify(`Blocked: ${result.reason}. Nothing was deployed.`);
      return "BLOCKED";
    }
  }

  const previous = getCurrentProduction(); // remember what to roll back to
  if (previous.ok) log(`Currently live: ${previous.id}`);

  const deployment = deploy();
  if (!deployment.ok) {
    notify(`Blocked: ${deployment.reason}. Production was not changed.`);
    return "BLOCKED";
  }

  const promoted = promote(deployment.url);
  if (!promoted.ok) {
    notify(`Blocked: ${promoted.reason}. Production was not changed.`);
    return "BLOCKED";
  }

  let health = await checkHealth(PRODUCTION_URL);
  if (health.ok) {
    notify(`Deployed and healthy: ${PRODUCTION_URL} (deployment ${deployment.url})`);
    return "SUCCESS";
  }

  // The new version is live but unhealthy. Decide: roll back, or escalate?
  while (!health.ok) {
    if (rollbacks >= MAX_ROLLBACKS || !previous.ok) {
      notify(
        `Still unhealthy after ${rollbacks} rollback(s). Guardrail reached. Escalating to human.`
      );
      return "ESCALATED";
    }
    notify(`Unhealthy (${health.reason}). Rolling back to ${previous.id}.`);
    rollbacks++;
    const rolledBack = rollback(previous.id);
    if (!rolledBack.ok) {
      notify(`Rollback failed (${rolledBack.reason}). Escalating to human.`);
      return "ESCALATED";
    }
    health = await checkHealth(PRODUCTION_URL); // observe again
  }

  notify(`Rolled back to ${previous.id}. The previous version is live and healthy.`);
  return "ROLLED_BACK";
}

runAgent()
  .then((outcome) => {
    log(`=== Agent finished: ${outcome} ===`);
    // Anything other than SUCCESS turns the Actions run red, so a human notices.
    process.exit(outcome === "SUCCESS" ? 0 : 1);
  })
  .catch((err) => {
    log(`Unexpected error: ${err.stack || err}`);
    log("=== Agent finished: ERROR ===");
    process.exit(1);
  });
