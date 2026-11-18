"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
};
const mins = (sec) => Math.max(1, Math.round(sec / 60)) + " min";
const api = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body && JSON.stringify(opts.body) }).then((r) => r.json());

const S = { episodes: [], segs: {}, user: { progress: {}, notes: {}, seen: {}, answers: {} }, cur: null, clip: null, lastSave: 0 };
const video = $("#video");

// ------------------------------------------------------------ data
async function loadAll() {
  const [eps, segData, user] = await Promise.all([api("/api/episodes"), api("/api/segments"), api("/api/user")]);
  S.episodes = eps;
  S.user = { progress: {}, notes: {}, seen: {}, answers: {}, ...user };
  S.segs = {};
  for (const ep of eps) {
    const list = (segData.episodes && segData.episodes[ep.num]) || [];
    S.segs[ep.num] = list.map((s, i) => ({
      ...s, ep: ep.num,
      end: s.end ?? (list[i + 1] ? list[i + 1].start : ep.length),
    }));
  }
}
const ep = (n) => S.episodes.find((e) => e.num === +n);
const allSegs = () => Object.values(S.segs).flat();
const segById = (id) => allSegs().find((s) => s.id === id);
const segAt = (n, t) => (S.segs[n] || []).find((s) => t >= s.start && t < s.end);

// ------------------------------------------------------------ routing
function go(hash) { location.hash = hash; }
function route() {
  const h = location.hash.slice(1) || "/highlights";
  const [path, q] = h.split("?");
  const params = new URLSearchParams(q || "");
  const parts = path.split("/").filter(Boolean);
  const view = parts[0] || "highlights";
  $$(".view").forEach((v) => v.classList.remove("active"));
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view !== "play" && !video.paused) video.pause();
  if (view === "play") {
    $("#view-player").classList.add("active");
    openPlayer(+parts[1], { t: params.has("t") ? +params.get("t") : null, clip: params.get("clip") });
  } else {
    $("#view-" + view)?.classList.add("active");
    if (view === "highlights") renderHighlights();
    if (view === "episodes") renderEpisodes();
    if (view === "notes") renderAllNotes();
  }
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------ highlights
function renderContinue() {
  const rows = Object.entries(S.user.progress)
    .map(([n, p]) => ({ e: ep(n), p }))
    .filter((r) => r.e && r.p.position > 20 && r.p.position < r.e.length - 60)
    .sort((a, b) => b.p.updated - a.p.updated)
    .slice(0, 4);
  $("#continue").innerHTML = rows.length
    ? `<h2>Pick up where you left off</h2><div class="cont-row">${rows.map(({ e, p }) => {
        const s = segAt(e.num, p.position);
        return `<button class="cont" data-ep="${e.num}"><span class="muted small">Episode ${e.num}</span>
          <b>${esc(e.title)}</b><span class="muted small">${fmt(p.position)} of ${fmt(e.length)}${s ? " · " + esc(s.title) : ""}</span>
          <div class="bar"><i style="width:${(100 * p.position) / e.length}%"></i></div></button>`;
      }).join("")}</div>`
    : "";
  $$(".cont").forEach((b) => (b.onclick = () => go(`/play/${b.dataset.ep}`)));
}

// The section you should watch next: finish the one you're partway through, else the next unseen one
// after where you last were, else the first unseen one in the series.
function upNext() {
  const ordered = S.episodes.flatMap((e) => S.segs[e.num] || []);
  if (!ordered.length) return null;
  const recent = Object.entries(S.user.progress).sort((a, b) => b[1].updated - a[1].updated)[0];
  if (recent) {
    const [n, p] = recent;
    const cur = segAt(+n, p.position);
    if (cur && !S.user.seen[cur.id] && p.position < cur.end - 20) return { seg: cur, from: p.position > cur.start + 20 ? p.position : cur.start };
    const i = ordered.findIndex((s) => s.ep === +n && s.start >= (cur ? cur.end - 1 : p.position));
    const nxt = ordered.slice(Math.max(0, i)).find((s) => !S.user.seen[s.id]);
    if (nxt) return { seg: nxt, from: nxt.start };
  }
  const first = ordered.find((s) => !S.user.seen[s.id]);
  return first ? { seg: first, from: first.start } : null;
}
function renderUpNext() {
  const u = upNext(), total = allSegs().length, seen = allSegs().filter((s) => S.user.seen[s.id]).length;
  if (!u) { $("#upnext").innerHTML = total ? `<div class="upnext"><h2>You've watched every section. 🌌</h2></div>` : ""; return; }
  const { seg: s, from } = u, e = ep(s.ep), parts = S.segs[s.ep], k = parts.indexOf(s) + 1;
  const left = s.end - from;
  $("#upnext").innerHTML = `<div class="upnext">
    <div class="muted small">UP NEXT · Episode ${e.num}, section ${k} of ${parts.length} · ${from > s.start ? `resume at ${fmt(from)}, ` : ""}${mins(left)}</div>
    <h2>${s.star ? '<span class="star">★</span> ' : ""}${esc(s.title)}</h2>
    <p>${esc(s.desc)}</p>
    <div class="row left"><button class="btn" id="upnextPlay">▶ Watch this section</button>
    <span class="muted small">${e.title} · You've watched ${seen} of ${total} sections</span></div>
    <div class="bar"><i style="width:${(100 * seen) / Math.max(1, total)}%"></i></div></div>`;
  $("#upnextPlay").onclick = () => go(`/play/${s.ep}?clip=${s.id}${from > s.start ? "&t=" + Math.floor(from) : ""}`);
}

function renderHighlights() {
  renderUpNext();
  renderContinue();
  const hide = $("#hideSeen").checked;
  const stars = allSegs().filter((s) => s.star && !(hide && S.user.seen[s.id]));
  if (!stars.length) {
    $("#highlightGrid").innerHTML = `<div class="empty">${hide ? "You've seen them all. Turn off the filter to rewatch." : "No highlights loaded yet."}</div>`;
    return;
  }
  $("#highlightGrid").innerHTML = stars.map((s) => {
    const e = ep(s.ep), seen = S.user.seen[s.id];
    return `<button class="card ${seen ? "seen" : ""}" data-id="${s.id}">
      <div class="meta"><span>Ep ${e.num} · ${esc(e.title)}</span><span>${mins(s.end - s.start)}</span></div>
      <h3><span class="star">★</span> ${esc(s.title)}</h3>
      <p>${esc(s.desc)}</p>
      <div class="foot"><span>${fmt(s.start)}–${fmt(s.end)}</span>${seen ? '<span class="seen-badge">✓ seen</span>' : `<span class="chip">${e.download.state === "done" ? "downloaded" : "streams"}</span>`}</div>
    </button>`;
  }).join("");
  $$("#highlightGrid .card").forEach((c) => (c.onclick = () => playClip(c.dataset.id)));
}
function playClip(id) { const s = segById(id); go(`/play/${s.ep}?clip=${id}`); }

// ------------------------------------------------------------ episodes
function dlLabel(d) {
  const pct = d.total ? Math.floor((100 * d.bytes) / d.total) : 0;
  if (d.state === "done") return "✓ downloaded";
  if (d.state === "downloading") return `downloading ${pct}%${d.speed ? " · " + (d.speed / 1048576).toFixed(1) + " MB/s" : ""}`;
  if (d.state === "queued") return "queued";
  if (d.state === "error") return `retrying… ${pct}%`;
  if (d.state === "partial") return `paused at ${pct}%`;
  return `${Math.round(d.total / 1048576)} MB`;
}
function segListHTML(n, curT = -1) {
  const segs = S.segs[n] || [];
  if (!segs.length) return `<div class="muted small" style="padding:8px">Sections for this episode are still being mapped.</div>`;
  return segs.map((s) => `<li data-id="${s.id}" data-t="${s.start}" class="${S.user.seen[s.id] ? "done" : ""} ${curT >= s.start && curT < s.end ? "now" : ""}">
      <span class="t">${fmt(s.start)}</span>
      <div><div class="name">${s.star ? '<span class="star">★</span> ' : ""}${esc(s.title)} <span class="muted small">· ${mins(s.end - s.start)}</span>${answeredBadge(s)}</div>
      <div class="d">${esc(s.desc)}</div></div></li>`).join("");
}
function renderEpisodes() {
  const open = new Set($$(".ep.open").map((e) => e.dataset.ep));
  $("#episodeList").innerHTML = S.episodes.map((e) => {
    const p = S.user.progress[e.num], d = e.download;
    const watched = p ? Math.min(100, (100 * p.position) / e.length) : 0;
    const nStars = (S.segs[e.num] || []).filter((s) => s.star).length;
    const btn = d.state === "done" ? "" : ["downloading", "queued", "error"].includes(d.state)
      ? `<button class="btn small ghost" data-stop="${e.num}">Pause</button>`
      : `<button class="btn small ghost" data-dl="${e.num}">Download</button>`;
    return `<div class="ep ${open.has(String(e.num)) ? "open" : ""}" data-ep="${e.num}">
      <div class="ep-head">
        <div class="ep-num">${e.num}</div>
        <div><div class="ep-title">${esc(e.title)}</div>
          <div class="ep-sub">${fmt(e.length)} · ${(S.segs[e.num] || []).length} sections${nStars ? ` · ${nStars} ★` : ""}${e.noteCount ? ` · ${e.noteCount} notes` : ""}${p ? ` · left off at ${fmt(p.position)}` : ""}</div>
          <div class="bar"><i style="width:${watched}%"></i></div>
          ${d.state !== "done" && d.bytes ? `<div class="bar dl"><i style="width:${(100 * d.bytes) / d.total}%"></i></div>` : ""}
        </div>
        <div class="ep-actions"><span class="dl-state">${dlLabel(d)}</span>${btn}
          <button class="btn small" data-play="${e.num}">${p && p.position > 20 ? "Resume" : "Play"}</button></div>
      </div>
      <ol class="segs ep-segs">${segListHTML(e.num)}</ol>
    </div>`;
  }).join("");
  $$(".ep-head").forEach((h) => (h.onclick = (ev) => { if (!ev.target.closest("button")) h.parentElement.classList.toggle("open"); }));
  $$("[data-play]").forEach((b) => (b.onclick = () => go(`/play/${b.dataset.play}`)));
  $$("[data-dl]").forEach((b) => (b.onclick = async () => { await api("/api/download", { method: "POST", body: { num: +b.dataset.dl } }); refreshEpisodes(); }));
  $$("[data-stop]").forEach((b) => (b.onclick = async () => { await api("/api/download/stop", { method: "POST", body: { num: +b.dataset.stop } }); refreshEpisodes(); }));
  $$(".ep-segs li").forEach((li) => (li.onclick = () => playClip(li.dataset.id)));
}
async function refreshEpisodes() {
  S.episodes = await api("/api/episodes");
  if ($("#view-episodes").classList.contains("active")) renderEpisodes();
}
$("#downloadAll").onclick = async () => { await api("/api/download", { method: "POST", body: { all: true } }); refreshEpisodes(); };
setInterval(() => { if ($("#view-episodes").classList.contains("active")) refreshEpisodes(); }, 2000);

// ------------------------------------------------------------ player
function openPlayer(n, { t, clip }) {
  const e = ep(n);
  if (!e) return go("/episodes");
  const switching = !S.cur || S.cur.num !== n;
  S.cur = e;
  S.clip = clip ? segById(clip) : null;
  S.qSeg = null; S.qShown = undefined;
  $("#playerTitle").textContent = `Episode ${e.num} · ${e.title}`;
  $("#clipDone").classList.add("hidden");
  const local = e.download.state === "done";
  $("#sourceNote").textContent = local
    ? "Playing from your downloaded copy."
    : "Streaming from archive.org (not downloaded yet). Your place and notes are saved either way.";
  let startAt = S.clip ? (t != null && t > S.clip.start && t < S.clip.end ? t : S.clip.start) : t;
  if (startAt == null) {
    const p = S.user.progress[n];
    startAt = p && p.position < e.length - 30 ? p.position : 0;
  }
  const seek = () => { video.currentTime = startAt; video.play().catch(() => {}); };
  if (switching) {
    video.innerHTML = "";
    video.src = local ? `/video/${n}` : e.remote;
    if (e.hasSubs) {
      const tr = document.createElement("track");
      Object.assign(tr, { kind: "subtitles", label: "English", srclang: "en", src: `/subs/${n}.vtt` });
      video.appendChild(tr);
    }
    video.addEventListener("loadedmetadata", seek, { once: true });
  } else seek();
  renderSegs();
  renderNotes();
  updateClipBanner();
}

// ------------------------------------------------------------ reflection questions
const answersFor = (id) => S.user.answers[id] || {};
function answeredBadge(s) {
  const n = (s.questions || []).length, a = Object.keys(answersFor(s.id)).length;
  return n && a ? `<span class="reflect-badge">✎ ${a}/${n}</span>` : "";
}
// The panel follows the section you're watching; after a section ends it stays on the one you just finished.
function renderQuestions(force) {
  if (!S.cur) return;
  const s = S.qSeg || segAt(S.cur.num, video.currentTime);
  if (!force && (s && s.id) === S.qShown) return;
  if (!force && $("#qList").contains(document.activeElement)) return; // don't yank the box out from under you
  S.qShown = s && s.id;
  $("#qFor").textContent = s ? s.title : "";
  if (!s || !(s.questions || []).length) { $("#qList").innerHTML = `<div class="empty muted">No questions for this part.</div>`; return; }
  const ans = answersFor(s.id);
  $("#qList").innerHTML = s.questions.map((q, i) => `<div class="q">
      <p><b>${i + 1}.</b>${esc(q)}</p>
      <textarea rows="3" data-q="${i}" placeholder="Your answer…">${esc((ans[i] && ans[i].text) || "")}</textarea>
      <div class="saved" data-saved="${i}"></div></div>`).join("");
  $$("#qList textarea").forEach((ta) => {
    let timer;
    const save = async () => {
      clearTimeout(timer);
      const q = +ta.dataset.q, text = ta.value, mark = $(`[data-saved="${q}"]`);
      const cur = (answersFor(s.id)[q] || {}).text || "";
      if (text === cur) return;
      await api(`/api/answers/${s.id}`, { method: "POST", body: { q, text } });
      const a = (S.user.answers[s.id] = S.user.answers[s.id] || {});
      if (text.trim()) a[q] = { text, updated: Date.now() / 1000 }; else delete a[q];
      if (!Object.keys(a).length) delete S.user.answers[s.id];
      mark.textContent = "saved ✓"; mark.className = "saved ok";
      setTimeout(() => { mark.textContent = ""; mark.className = "saved"; }, 1500);
      $("#segList").innerHTML && renderSegList();
    };
    ta.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(save, 900); });
    ta.addEventListener("blur", save);
  });
}
$("#clipReflect").onclick = () => {
  renderQuestions(true);
  $("#qPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#qPanel").classList.add("flash"); setTimeout(() => $("#qPanel").classList.remove("flash"), 1200);
  const first = $$("#qList textarea").find((t) => !t.value.trim()) || $("#qList textarea");
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 400);
};

function renderSegList() {
  $("#segList").innerHTML = segListHTML(S.cur.num, video.currentTime);
  $$("#segList li").forEach((li) => (li.onclick = () => {
    S.qSeg = null;
    S.clip = segById(li.dataset.id); updateClipBanner(); $("#clipDone").classList.add("hidden");
    video.currentTime = +li.dataset.t; video.play();
  }));
}
function renderSegs() {
  if (!S.cur) return;
  renderSegList();
  const s = segAt(S.cur.num, video.currentTime);
  renderQuestions();
  $("#currentSeg").innerHTML = s ? `<div class="muted small">Now: section ${S.segs[S.cur.num].indexOf(s) + 1} of ${S.segs[S.cur.num].length} · ${fmt(s.start)}–${fmt(s.end)}</div>
    <h3>${s.star ? '<span class="star">★</span> ' : ""}${esc(s.title)}</h3><p>${esc(s.desc)}</p>` : "";
}

function updateClipBanner() {
  const c = S.clip;
  $("#clipBanner").classList.toggle("hidden", !c);
  if (!c) return;
  $("#clipTitle").textContent = c.title;
  $("#clipRemain").textContent = `· ${fmt(Math.max(0, c.end - video.currentTime))} left`;
}
$("#clipKeep").onclick = () => { S.clip = null; updateClipBanner(); };
$("#clipReplay").onclick = () => { const c = S.lastClip; $("#clipDone").classList.add("hidden"); S.clip = c; video.currentTime = c.start; video.play(); updateClipBanner(); };
$("#clipNext").onclick = () => {
  $("#clipDone").classList.add("hidden");
  const n = S.nextClip;
  if (!n) return;
  if (n.ep !== S.cur.num) return go(`/play/${n.ep}?clip=${n.id}`);
  S.clip = n; video.currentTime = n.start; updateClipBanner();
  video.play();
};

let lastSegId = null;
video.addEventListener("timeupdate", () => {
  if (!S.cur) return;
  const t = video.currentTime;
  if (S.noteT == null) $("#noteAt").textContent = fmt(t);
  const s = segAt(S.cur.num, t);
  // mark a topic as seen when playback runs naturally through its end
  if (lastSegId && (!s || s.id !== lastSegId)) {
    const prev = segById(lastSegId);
    if (prev && t >= prev.end - 0.5 && t < prev.end + 3) markSeen(prev.id);
  }
  if ((s && s.id) !== lastSegId) { lastSegId = s && s.id; renderSegs(); }
  if (S.clip) {
    updateClipBanner();
    if (t >= Math.min(S.clip.end, (video.duration || Infinity) - 0.3)) finishClip();
  }
  if (Date.now() - S.lastSave > 5000) saveProgress();
});
// The last section of an episode ends with the video itself.
video.addEventListener("ended", () => {
  if (S.clip) return finishClip();
  const last = S.cur && (S.segs[S.cur.num] || []).slice(-1)[0];
  if (last) markSeen(last.id);
});
function finishClip() {
  video.pause();
  markSeen(S.clip.id);
  S.lastClip = S.clip;
  S.qSeg = S.clip; // keep the questions on the section you just finished
  // next section in this episode, or the first section of the next episode
  const next = (S.segs[S.cur.num] || []).find((x) => x.start >= S.clip.end - 1) || (S.segs[S.cur.num + 1] || [])[0];
  S.nextClip = next;
  saveProgress();
  $("#clipDoneText").textContent = `"${S.clip.title}" — a good place to stop. Your place is saved.`;
  $("#clipNext").classList.toggle("hidden", !next);
  $("#clipNextName").textContent = next ? (next.ep !== S.cur.num ? `Episode ${next.ep}: ` : "") + next.title : "";
  $("#clipReflect").classList.toggle("hidden", !(S.clip.questions || []).length);
  S.clip = null; updateClipBanner();
  $("#clipDone").classList.remove("hidden");
  renderQuestions(true);
}
video.addEventListener("pause", () => saveProgress());
video.addEventListener("play", () => { $("#clipDone").classList.add("hidden"); if (S.qSeg) { S.qSeg = null; renderQuestions(); } });
window.addEventListener("beforeunload", () => saveProgress(true));

function saveProgress(beacon) {
  if (!S.cur || !video.duration || video.currentTime < 1) return;
  S.lastSave = Date.now();
  const body = { position: video.currentTime, duration: video.duration };
  S.user.progress[S.cur.num] = { ...body, updated: Date.now() / 1000 };
  const url = `/api/progress/${S.cur.num}`;
  if (beacon) navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: "application/json" }));
  else api(url, { method: "POST", body });
}
function markSeen(id) {
  if (S.user.seen[id]) return;
  S.user.seen[id] = Date.now() / 1000;
  api(`/api/seen/${id}`, { method: "POST", body: { seen: true } });
  renderSegs();
}

// ------------------------------------------------------------ notes
function noteItems(n, list) {
  return list.map((x) => `<li data-ep="${n}" data-id="${x.id}">
    <span class="t" data-t="${x.t}">${fmt(x.t)}</span>
    <span class="txt">${esc(x.text)}</span>
    <span class="acts"><button data-edit>edit</button><button data-del>delete</button></span></li>`).join("");
}
function wireNotes(root) {
  $$(".t", root).forEach((el) => (el.onclick = () => {
    const n = el.closest("li").dataset.ep;
    if (S.cur && S.cur.num === +n && $("#view-player").classList.contains("active")) { video.currentTime = +el.dataset.t; video.play(); }
    else go(`/play/${n}?t=${el.dataset.t}`);
  }));
  $$("[data-del]", root).forEach((b) => (b.onclick = async () => {
    const li = b.closest("li");
    if (!confirm("Delete this note?")) return;
    await fetch(`/api/notes/${li.dataset.ep}/${li.dataset.id}`, { method: "DELETE" });
    S.user.notes[li.dataset.ep] = (S.user.notes[li.dataset.ep] || []).filter((x) => x.id !== li.dataset.id);
    renderNotes(); if ($("#view-notes").classList.contains("active")) renderAllNotes();
  }));
  $$("[data-edit]", root).forEach((b) => (b.onclick = () => {
    const li = b.closest("li"), note = S.user.notes[li.dataset.ep].find((x) => x.id === li.dataset.id);
    const txt = $(".txt", li);
    txt.innerHTML = `<textarea rows="3">${esc(note.text)}</textarea><button class="btn small">Save</button>`;
    const ta = $("textarea", txt); ta.focus();
    $("button", txt).onclick = async () => {
      const saved = await api(`/api/notes/${li.dataset.ep}`, { method: "POST", body: { id: note.id, text: ta.value } });
      Object.assign(note, saved);
      renderNotes(); if ($("#view-notes").classList.contains("active")) renderAllNotes();
    };
  }));
}
function renderNotes() {
  if (!S.cur) return;
  const list = S.user.notes[S.cur.num] || [];
  $("#noteList").innerHTML = list.length ? noteItems(S.cur.num, list) : `<li class="muted small" style="display:block">No notes yet for this episode.</li>`;
  wireNotes($("#noteList"));
}
function renderAllNotes() {
  const html = S.episodes.map((e) => {
    const notes = S.user.notes[e.num] || [];
    const answered = (S.segs[e.num] || []).filter((s) => Object.keys(answersFor(s.id)).length);
    if (!notes.length && !answered.length) return "";
    const refl = answered.map((s) => `<div class="refl-seg"><h4 data-clip="${s.id}">${s.star ? "★ " : ""}${esc(s.title)} <span class="muted small">· ${fmt(s.start)}</span></h4>
      ${s.questions.map((q, i) => answersFor(s.id)[i] ? `<div class="refl-qa"><div class="qq">${esc(q)}</div><div class="aa">${esc(answersFor(s.id)[i].text)}</div></div>` : "").join("")}</div>`).join("");
    return `<div class="all-ep panel"><h3>Episode ${e.num} · ${esc(e.title)}</h3>
      ${answered.length ? `<div class="sublabel">Reflections</div><div class="reflections">${refl}</div>` : ""}
      ${notes.length ? `<div class="sublabel">Notes</div><ul class="notes">${noteItems(e.num, notes)}</ul>` : ""}</div>`;
  }).join("");
  $("#allNotes").innerHTML = html || `<div class="empty">Nothing yet. While watching, answer the questions in "Think about it" or jot a note (press N on a computer).</div>`;
  wireNotes($("#allNotes"));
  $$("#allNotes [data-clip]").forEach((h) => (h.onclick = () => playClip(h.dataset.clip)));
}
$("#noteForm").onsubmit = async (ev) => {
  ev.preventDefault();
  const text = $("#noteText").value.trim();
  if (!text || !S.cur) return;
  const n = S.cur.num;
  const saved = await api(`/api/notes/${n}`, { method: "POST", body: { t: S.noteT ?? video.currentTime, text } });
  (S.user.notes[n] = S.user.notes[n] || []).push(saved);
  S.user.notes[n].sort((a, b) => a.t - b.t);
  $("#noteText").value = ""; S.noteT = null; $("#noteText").blur();
  renderNotes();
};
// pin the note's timestamp to the moment you start typing
$("#noteText").addEventListener("focus", () => { S.noteT = video.currentTime; $("#noteAt").textContent = fmt(S.noteT); });
$("#noteText").addEventListener("blur", () => { if (!$("#noteText").value.trim()) S.noteT = null; });
$("#noteText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("#noteForm").requestSubmit(); });

// ------------------------------------------------------------ keys + nav
document.addEventListener("keydown", (e) => {
  if (!$("#view-player").classList.contains("active") || e.target.matches("textarea, input")) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); video.pause(); $("#noteText").focus(); }
  else if (e.key === " ") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  else if (e.key === "ArrowRight") video.currentTime += 10;
  else if (e.key === "ArrowLeft") video.currentTime -= 10;
});
$$(".tabs button").forEach((b) => (b.onclick = () => go("/" + b.dataset.view)));
$("#homeLink").onclick = () => go("/highlights");
$("#backBtn").onclick = () => history.length > 1 ? history.back() : go("/highlights");
$("#hideSeen").onchange = renderHighlights;
window.addEventListener("hashchange", route);

// "Open on phone" (only shown on the PC itself)
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  api("/api/lan").then(({ url }) => {
    if (!url) return;
    $("#phoneBtn").classList.remove("hidden");
    $("#phoneBtn").onclick = () => {
      const full = url + "/" + location.hash;
      $("#lanUrl").textContent = url;
      $("#qr").innerHTML = "";
      if (window.QRCode) new QRCode($("#qr"), { text: full, width: 200, height: 200, colorDark: "#000", colorLight: "#fff" });
      $("#phonePop").classList.remove("hidden");
    };
  }).catch(() => {});
}
$("#phoneClose").onclick = () => $("#phonePop").classList.add("hidden");
$("#phonePop").onclick = (e) => { if (e.target.id === "phonePop") $("#phonePop").classList.add("hidden"); };

loadAll().then(route);
