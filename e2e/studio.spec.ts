// End-to-end tests of the web app. The first block ports every assertion of
// prototype/tests/smoke_prototype.py; the rest cover the UI gestures the prototype tested by hand.
import { expect, test, type Page } from "@playwright/test";

// The same scripted Claude stub as the prototype smoke test: tool calls run against canned requests.
const STUB = String.raw`
window.__calls = [];
const fake = async (input, opts) => {
  const last = input[input.length - 1].content; window.__lastInput = input;
  const T = n => opts.tools.find(t => t.name === n);
  const run = async (n, a) => { try { const r = await T(n).execute(a, { signal: new AbortController().signal }); window.__calls.push([n, 'ok', r]); } catch (e) { window.__calls.push([n, 'err', e.message]); } };
  if (last.includes('TEST1')) {
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: 'kick', steps: 'x---x---x---x---' }] });
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: 'closed hat', steps: 'oo-xoo-xoo-xoo-x' }, { sound: 'THK_HatO_04_Dark', steps: '--x---x---x---x-' }] });
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 4, pattern_bars: 1, lanes: [{ sound: 'banana', steps: 'x---' }] });
    await run('write_notes', { track: 'Bass', start_bar: 9, bars: 8, pattern_bars: 1, notes: [{ step: 2, note: 'F2', len: 2 }, { step: 6, note: 'G#2', len: 1 }], sound: 'THK_Bass_25_Fat_Ladder_C' });
    await run('set_song', { key: 'G', bpm: 126 });
    opts.onText({ text: 'Wrote a kick and hats on Groove.', delta: 'x' });
    return { text: 'Wrote a kick and hats on Groove.', truncated: false, modelTierApplied: 'quick' };
  }
  if (last.includes('TEST2')) {
    await run('offer_variations', { title: 'Drums for the bass', variations: [
      { name: 'Sparse', kind: 'drums', track: 'Tops', start_bar: 9, bars: 16, pattern_bars: 1, lanes: [{ sound: 'open hat', steps: '--x---x---x---x-' }] },
      { name: 'Busy', kind: 'drums', track: 'Tops', start_bar: 9, bars: 16, pattern_bars: 2, lanes: [{ sound: 'ride', steps: 'o-xo' }, { sound: 'clap', steps: '----x-------x---' }] },
      { name: 'Bass alt', kind: 'notes', track: 'Bass', start_bar: 9, bars: 16, pattern_bars: 1, notes: [{ step: 3, note: 'F1', len: 1 }] } ] });
    opts.onText({ text: 'Here are three.', delta: 'x' });
    return { text: 'Here are three.', truncated: false, modelTierApplied: 'quick' };
  }
  throw { code: 'rate_limited', message: 'x' };
};
fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
window.claude = { use: async n => n === 'sample' ? fake : null };
`;

const OLD = {
  v: 1, name: "Old", bpm: 124, swing: 54, loop: { on: false, start: 0, end: 4 },
  tracks: [{ id: "a1", name: "Drums", type: "drums", color: 0, vol: 0.8, pan: 0, cutoff: 20000, send: 0, mute: false, solo: false, clips: [],
    pads: ["THK_Kick_02_Classic_909_G", "THK_Perc_01_Clap_Classic", "THK_Perc_04_Hat_Closed_Tight", "THK_Perc_06_Hat_Open", "THK_Perc_08_Shaker", "THK_Perc_09_Rim_Shot", "THK_Perc_10_Snare_Tech", "THK_Perc_11_Conga_Hi"] }],
}; // prettier-ignore

/** Evaluates in the page with the app's test hook as `t` (window.__thk). */
const ev = <R>(page: Page, body: string): Promise<R> =>
  page.evaluate(
    `(async () => { const t = window.__thk; const S = () => t.get().song; const find = n => t.song.findTrack(S(), n); ${body} })()`,
  );

/** Loads a clean studio. By default the API reports no key, so the claude.ai stub drives the assistant. */
async function fresh(page: Page, errors: string[], apiConfigured = false) {
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.route("**/api/assistant/status", (r) =>
    r.fulfill({ json: { configured: apiConfigured, model: "claude-opus-5-5" } }),
  );
  await page.addInitScript(STUB);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#playBtn")).toBeVisible();
}

test.describe("prototype smoke test, ported", () => {
  test("decodes the song's sounds, migrates v2 ids, plays, exports, runs the assistant and variations", async ({
    page,
  }) => {
    const errors: string[] = [];
    await fresh(page, errors);

    // sounds the song uses are decoded (the rest load lazily)
    await expect
      .poll(() =>
        ev<number>(
          page,
          "const ids = t.audio().bank, used = new Set(); for (const tr of S().tracks) (tr.type === 'drums' ? tr.pads : [tr.sample]).forEach(x => x && used.add(x)); return [...used].filter(id => !ids.has(id)).length;",
        ),
      )
      .toBe(0);

    // migration of v2 ids
    await page.evaluate((s) => localStorage.setItem("thk-studio-song-v1", JSON.stringify(s)), OLD);
    await page.reload();
    expect(await ev(page, "return S().tracks[0].pads[1];")).toBe("THK_Clap_01_Classic");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#songName")).toHaveValue("Late Shift (demo)");

    // playback advances
    await page.click("#playBtn");
    await page.waitForTimeout(1200);
    expect(await ev<number>(page, "return t.audio().transport.frame();")).toBeGreaterThan(4);
    await page.click("#playBtn");

    // export pipeline (without the download)
    const r = await ev<{ secs: number; pk: number; mid: number[]; zip: number }>(
      page,
      `const { zip, buffer } = await t.buildExport(S()); let pk = 0;
       for (let c = 0; c < 2; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }
       return { secs: buffer.duration, pk, mid: Array.from(t.song.encodeMidi(S()).slice(0, 4)), zip: zip.length };`,
    );
    expect(r.secs).toBeGreaterThan(60);
    expect(r.pk).toBeGreaterThan(0.1);
    expect(r.pk).toBeLessThanOrEqual(1.0);
    expect(r.mid).toEqual([77, 84, 104, 100]);
    expect(r.zip).toBeGreaterThan(1e6);

    // assistant: tools write, errors roll back, one undo per turn
    await page.fill("#prompt", "TEST1");
    await page.keyboard.press("Enter");
    await expect.poll(() => ev<unknown[]>(page, "return window.__calls.length;")).toBe(5);
    const calls = await ev<[string, string, string][]>(page, "return window.__calls;");
    expect(calls.map((c) => c[1])).toEqual(["ok", "ok", "err", "ok", "ok"]);
    expect(await ev(page, "return find('Groove').clips[0].notes.length;")).toBe(20);
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Bass_25_Fat_Ladder_C");
    expect(await ev(page, "return window.__lastInput[0].content.includes('Sound catalog');")).toBe(true);
    await expect(page.locator(".msg.bot").last()).toContainText("✕ Unknown drum sound");
    await page.click("text=Undo these changes");
    expect(await ev(page, "return find('Groove') ?? null;")).toBeNull();
    expect(await ev(page, "return S().bpm;")).toBe(125);

    // variations: try swaps, back restores exactly, keep adds one undo step
    await page.fill("#prompt", "TEST2");
    await page.keyboard.press("Enter");
    await expect(page.locator(".var")).toHaveCount(3);
    const before = await ev<string>(page, "return JSON.stringify(S().tracks);");
    const card = (i: number) => page.locator(".var").nth(i).locator("button").first();
    await card(1).click();
    await expect.poll(() => ev(page, "return t.get().playing && S().loop.on;")).toBe(true);
    await card(2).click();
    await page.click("text=Back to original");
    expect(await ev<string>(page, "return JSON.stringify(S().tracks);")).toBe(before);
    await card(0).click();
    const u0 = await ev<number>(page, "return t.get().history.past.length;");
    await page.click(".var button:has-text('Keep')");
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(u0 + 1);
    await page.click("#playBtn");

    // groove preset follows the key
    await ev(page, "const b = find('Bass'); t.select({ tid: b.id, cid: b.clips[0].id });");
    await page.selectOption("select[aria-label='Apply a groove preset']", { label: "Acid walk" });
    expect(
      await ev(
        page,
        "const tr = t.song.trackById(S(), t.get().sel.tid); return t.song.pname(tr.clips.find(c => c.id === t.get().sel.cid).notes[0].p);",
      ),
    ).toBe("F2");

    expect(errors).toEqual([]);
  });

  test("a failed assistant call shows plain error copy", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.fill("#prompt", "anything else");
    await page.keyboard.press("Enter");
    await expect(page.locator(".acts .err").last()).toHaveText(
      "✕ Claude is busy or you've reached a usage limit. Try again in a little while.",
    );
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe("assistant through the API", () => {
  test("replays the server's edits as one undo step and shows its variations", async ({ page }) => {
    const errors: string[] = [];
    let sent: { request?: string; song?: { name: string }; tier?: string } = {};
    await page.route("**/api/assistant", async (r) => {
      sent = r.request().postDataJSON();
      await r.fulfill({
        json: {
          text: "Added a kick and offbeat hats on Groove, and three bass ideas.",
          steps: [
            { tool: "write_drums", ok: true, text: "Groove bars 1–16 (1-bar pattern): kick Classic 909 ×4" },
            { tool: "write_drums", ok: false, text: 'Unknown drum sound "banana".' },
            { tool: "set_song", ok: true, text: "Song: 126 BPM" },
            { tool: "offer_variations", ok: true, text: "Shown 1 variations as cards." },
          ],
          edits: [
            { tool: "write_drums", input: { track: "Groove", start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: "kick", steps: "x---x---x---x---" }, { sound: "open hat", steps: "--x-" }] } },
            { tool: "set_song", input: { bpm: 126 } },
          ],
          variations: [{ title: "Bass ideas", specs: [{ name: "Low roll", why: "", kind: "notes", track: "Bass", start: 8, len: 16, loop: 1, notes: [{ step: 2, note: "F1", len: 1 }], replace: true }] }],
          stop: "done",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      });
    }); // prettier-ignore
    await fresh(page, errors, true);
    await expect(page.locator("#sendBtn")).toBeEnabled();
    await page.fill("#prompt", "kick and hats please");
    await page.keyboard.press("Enter");
    const bot = page.locator(".msg.bot").last();
    await expect(bot.locator(".body")).toHaveText("Added a kick and offbeat hats on Groove, and three bass ideas.");
    expect(sent.request).toBe("kick and hats please");
    expect(sent.song?.name).toBe("Late Shift (demo)");
    expect(sent.tier).toBe("quick");
    await expect(bot.locator(".acts > div")).toHaveText([
      "✓ Groove bars 1–16 (1-bar pattern): kick Classic 909 ×4, open hat Medium ×4",
      '✕ Unknown drum sound "banana".',
      "✓ Song: 126 BPM",
      "✓ Offered 1 variations",
    ]);
    expect(await ev(page, "return [find('Groove').clips[0].notes.length, S().bpm];")).toEqual([8, 126]);
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(1);
    await expect(bot.locator(".var")).toHaveCount(1);
    await bot.getByRole("button", { name: "Undo these changes" }).click();
    expect(await ev(page, "return [find('Groove') ?? null, S().bpm];")).toEqual([null, 125]);
    expect(errors).toEqual([]);
  });

  test("explains a missing key and a rejected key", async ({ page }) => {
    const errors: string[] = [];
    await page.route("**/api/assistant", (r) => r.fulfill({ status: 502, json: { code: "auth" } }));
    await fresh(page, errors, true);
    await page.fill("#prompt", "hello");
    await page.keyboard.press("Enter");
    await expect(page.locator(".acts .err").last()).toHaveText(
      "✕ Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local, then restart the studio.",
    );
    expect(errors).toEqual([]);
  });
});

test.describe("editing by hand", () => {
  test("draw a clip, add notes, undo and redo each step", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.click("#addSynth");
    const lane = page.locator(".lane").last();
    const box = (await lane.boundingBox())!;
    const ppb = 48;
    await page.mouse.move(box.x + ppb * 2 + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + ppb * 5 + 5, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await ev(page, "const c = find('Synth 3').clips[0]; return [c.start, c.len, c.loop];")).toEqual([2, 4, 4]);

    await page.locator("#rollScroll").scrollIntoViewIfNeeded();
    const grid = page.locator("#rollGrid");
    const g = (await grid.boundingBox())!;
    // two clicks: a note, then a click on it deletes it
    await page.mouse.click(g.x + 22 * 3 + 5, g.y + 15 * 31 + 5); // step 3, pitch 72 - 31 = 41 (F2)
    expect(await ev(page, "return find('Synth 3').clips[0].notes;")).toEqual([{ t: 3, d: 2, p: 41, v: 1 }]);
    await page.mouse.click(g.x + 22 * 3 + 5, g.y + 15 * 31 + 5);
    expect(await ev(page, "return find('Synth 3').clips[0].notes.length;")).toBe(0);
    await page.keyboard.press("Meta+z");
    expect(await ev(page, "return find('Synth 3').clips[0].notes.length;")).toBe(1);
    // drag the note two steps right and three semitones up: one undo step
    await page.mouse.move(g.x + 22 * 3 + 5, g.y + 15 * 31 + 5);
    await page.mouse.down();
    await page.mouse.move(g.x + 22 * 5 + 5, g.y + 15 * 28 + 5, { steps: 5 });
    await page.mouse.up();
    expect(await ev(page, "return find('Synth 3').clips[0].notes;")).toEqual([{ t: 5, d: 2, p: 44, v: 1 }]);
    await page.click("#undoBtn");
    expect(await ev(page, "return find('Synth 3').clips[0].notes;")).toEqual([{ t: 3, d: 2, p: 41, v: 1 }]);
    await page.click("#redoBtn");
    expect(await ev(page, "return find('Synth 3').clips[0].notes[0].t;")).toBe(5);
    expect(errors).toEqual([]);
  });

  test("move a clip; overlapping is refused", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    const clip = page.locator(".clip", { hasText: "Rolling F" }).first();
    const b = (await clip.boundingBox())!;
    await page.mouse.move(b.x + 20, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 20 + 48 * 2, b.y + 20, { steps: 4 });
    await page.mouse.up();
    expect(await ev(page, "return find('Bass').clips.map(c => c.start);")).toEqual([10, 28]);
    // moving it onto the clip at bar 29 overlaps
    const b2 = (await clip.boundingBox())!;
    await page.mouse.move(b2.x + 20, b2.y + 20);
    await page.mouse.down();
    await page.mouse.move(b2.x + 20 + 48 * 6, b2.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator("#toast")).toHaveText("Clips on the same track can't overlap.");
    expect(await ev(page, "return find('Bass').clips.map(c => c.start);")).toEqual([10, 28]);
    expect(errors).toEqual([]);
  });

  test("a fader drag is one undo step; mute, loop and the sound browser work", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    const vol = page.getByLabel("Kick volume");
    await vol.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    expect(await ev<number>(page, "return find('Kick').vol;")).toBeCloseTo(0.87);
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(1);
    await page.click("#undoBtn");
    expect(await ev<number>(page, "return find('Kick').vol;")).toBeCloseTo(0.92);

    await page.locator(".thead").first().getByTitle("Mute").click();
    expect(await ev(page, "return find('Kick').mute;")).toBe(true);
    await page.keyboard.press("l");
    expect(await ev(page, "return S().loop.on;")).toBe(true);

    await page.getByRole("button", { name: "Claps" }).click();
    await expect(page.locator("#catCount")).toHaveText("8 sounds");
    await page.locator(".item", { hasText: "Big 909" }).getByRole("button", { name: "Use" }).click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Clap_08_Big_909");
    await expect(page.locator("#toast")).toHaveText("Bass now plays Big 909.");
    expect(errors).toEqual([]);
  });

  test("local variations: three cards, Try loops in place, Back restores", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.getByRole("button", { name: "3 variations" }).click();
    await expect(page.locator(".var")).toHaveCount(3);
    const before = await ev<string>(page, "return JSON.stringify(S());");
    await page.locator(".var").first().getByRole("button", { name: "Try" }).click();
    expect(await ev(page, "return S().loop;")).toEqual({ on: true, userSet: true, start: 8, end: 12 });
    await page.click("text=Back to original");
    expect(await ev<string>(page, "return JSON.stringify(S());")).toBe(before);
    await page.click("#playBtn");
    expect(errors).toEqual([]);
  });

  test("new empty song is one undo away", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.click("#newBtn");
    await page.getByRole("button", { name: "Empty song (drum + bass track)" }).click();
    expect(await ev(page, "return [S().name, S().tracks.length, t.song.songEnd(S())];")).toEqual([
      "Untitled song",
      2,
      0,
    ]);
    await page.click("#undoBtn");
    await expect(page.locator("#songName")).toHaveValue("Late Shift (demo)");
    expect(errors).toEqual([]);
  });
});
