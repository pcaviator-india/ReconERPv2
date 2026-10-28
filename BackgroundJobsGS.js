/**
 * BackgroundJobsGS.js
 * Generic background-job progress store for non-blocking Req / Quote saves.
 *
 * Pattern (Apps Script has no true background threads):
 *  1. Client calls a FAST function (sheet writes only) -> returns in 1-3s.
 *  2. Client closes the modal immediately, pushes a bubble card, and fires
 *     the SLOW function (PDF + email + stock) with google.script.run WITHOUT
 *     blocking the UI (fire-and-forget).
 *  3. The slow function calls bgUpdateJob() at each stage. The bubble polls
 *     bgGetJobs([ids]) every 2.5s on a SEPARATE google.script.run channel,
 *     so the user sees live progress while free to approve/edit the next one.
 *
 * Store: ScriptCache (fast, per-execution readable while slow job runs).
 * No new sheet required. Job payloads are NOT stored server-side — the
 * browser holds them and passes them to the slow call.
 */

var BG_JOB_TTL_SEC_ = 21600; // 6h
var BG_JOB_PREFIX_ = "bgjob_";

function bgJobKey_(jobId) {
  return BG_JOB_PREFIX_ + String(jobId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
}

function bgNowIso_() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return String(new Date());
  }
}

/**
 * Create a job entry. Called by fast functions before returning.
 * @param {string} type 'REQ' | 'QUOTE'
 * @param {string} refId orderId / quoteId
 * @param {string} title human label for the bubble
 * @param {string} userEmail
 * @return {{jobId:string}}
 */
function bgEnqueueJob(type, refId, title, userEmail) {
  var jobId = (type === "QUOTE" ? "Q-" : "REQ-") +
    String(refId || "x").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) +
    "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1296).toString(36);
  var job = {
    jobId: jobId,
    type: type,
    refId: String(refId || ""),
    title: String(title || (type + " " + refId)),
    status: "RUNNING",
    progress: 5,
    step: "Sheet saved — finishing in background…",
    createdBy: String(userEmail || ""),
    createdAt: bgNowIso_(),
    updatedAt: bgNowIso_(),
    pdfUrl: "",
    emailSent: null,
    error: ""
  };
  try {
    CacheService.getScriptCache().put(bgJobKey_(jobId), JSON.stringify(job), BG_JOB_TTL_SEC_);
  } catch (e) { /* cache best-effort */ }
  return { jobId: jobId, job: job };
}

function bgUpdateJob(jobId, progress, step, extra) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(bgJobKey_(jobId));
    var job = raw ? JSON.parse(raw) : { jobId: jobId, status: "RUNNING" };
    job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
    job.step = String(step || job.step || "");
    job.updatedAt = bgNowIso_();
    if (extra) {
      if (extra.pdfUrl !== undefined) job.pdfUrl = extra.pdfUrl;
      if (extra.emailSent !== undefined) job.emailSent = extra.emailSent;
      if (extra.error !== undefined) job.error = extra.error;
    }
    cache.put(bgJobKey_(jobId), JSON.stringify(job), BG_JOB_TTL_SEC_);
  } catch (e) { /* best-effort */ }
}

function bgFinishJob(jobId, success, extra) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(bgJobKey_(jobId));
    var job = raw ? JSON.parse(raw) : { jobId: jobId };
    job.status = success ? "DONE" : "ERROR";
    job.progress = success ? 100 : (Number(job.progress) || 50);
    job.updatedAt = bgNowIso_();
    if (extra) {
      if (extra.step) job.step = String(extra.step);
      if (extra.pdfUrl !== undefined) job.pdfUrl = extra.pdfUrl;
      if (extra.emailSent !== undefined) job.emailSent = extra.emailSent;
      if (extra.error !== undefined) job.error = String(extra.error || "");
      if (extra.result !== undefined) job.result = extra.result;
    } else if (!success && !job.step) {
      job.step = "Failed";
    }
    if (success && !extra?.step) job.step = "Done ✓";
    cache.put(bgJobKey_(jobId), JSON.stringify(job), BG_JOB_TTL_SEC_);
    return job;
  } catch (e) {
    return { jobId: jobId, status: success ? "DONE" : "ERROR" };
  }
}

/**
 * Poll endpoint for the bubble. Batch-safe: one call for all visible cards.
 * @param {string[]} jobIds
 * @return {Object[]} jobs
 */
function bgGetJobs(jobIds) {
  var out = [];
  try {
    var cache = CacheService.getScriptCache();
    (jobIds || []).forEach(function (id) {
      try {
        var raw = cache.get(bgJobKey_(id));
        if (raw) out.push(JSON.parse(raw));
        else out.push({ jobId: id, status: "UNKNOWN", progress: 0, step: "Expired or unknown job" });
      } catch (e) {
        out.push({ jobId: id, status: "UNKNOWN", progress: 0, step: "Read error" });
      }
    });
  } catch (e) {
    (jobIds || []).forEach(function (id) {
      out.push({ jobId: id, status: "UNKNOWN", progress: 0, step: "Cache unavailable" });
    });
  }
  return out;
}
