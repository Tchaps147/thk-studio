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
      "✕ The assistant is busy or you've reached a usage limit. Choose the other assistant or try again later.",
    );
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe("assistant through the API", () => {
  test("selects ChatGPT, remembers the choice, labels fallback replies and undoes their edits", async ({ page }) => {
    const errors: string[] = [];
    const providers: string[] = [];
    await page.route("**/api/assistant", async (r) => {
      providers.push(r.request().postDataJSON().provider);
      await r.fulfill({
        json: {
          provider: "chatgpt",
          model: "account-default",
          fallback: { from: "claude", code: "rate_limited" },
          text: "Your kick is ready.",
          steps: [{ tool: "write_drums", ok: true, text: "Kick" }],
          edits: [
            {
              tool: "write_drums",
              input: {
                track: "Groove",
                start_bar: 1,
                bars: 4,
                pattern_bars: 1,
                lanes: [{ sound: "kick", steps: "x---" }],
              },
            },
          ],
          variations: [],
          stop: "done",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      });
    });
    await fresh(page, errors, true);
    await page.route("**/api/assistant/status", (r) =>
      r.fulfill({
        json: {
          configured: true,
          providers: { chatgpt: { configured: true } },
        },
      }),
    );
    await page.reload();
    const selector = page.getByRole("combobox", { name: "AI provider" });
    await expect(selector).toHaveValue("auto");
    await page.fill("#prompt", "add a kick");
    await page.keyboard.press("Enter");
    const bot = page.locator(".msg.bot").last();
    await expect(bot.locator(".who")).toHaveText("ChatGPT");
    await expect(bot.locator(".acts")).toContainText("Claude was unavailable. ChatGPT handled this request.");
    expect(await ev<number>(page, "return t.get().history.past.length;")).toBe(1);
    await bot.getByRole("button", { name: "Undo these changes" }).click();
    expect(await ev(page, "return find('Groove') ?? null;")).toBeNull();
    await selector.selectOption("chatgpt");
    await page.reload();
    await expect(selector).toHaveValue("chatgpt");
    await expect(page.locator(".assistant-status")).toContainText("ChatGPT connected");
    await page.fill("#prompt", "add another kick");
    await page.keyboard.press("Enter");
    await expect(page.locator(".msg.bot").last().locator(".body")).toHaveText("Your kick is ready.");
    expect(providers).toEqual(["auto", "chatgpt"]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: "/tmp/thk-chatgpt-ui.png", fullPage: true });
  });

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
    await expect(page.locator("#catCount")).toHaveText("30 sounds");
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

test.describe("sound maker", () => {
  test("searches the full library and filters recorded instruments without preloading categories", async ({ page }) => {
    const errors: string[] = [],
      recordings: string[] = [];
    await fresh(page, errors);
    page.on("request", (request) => {
      if (/\/kit\/(REC_|THK_Library_)/.test(request.url())) recordings.push(request.url());
    });
    const original = await ev(page, "return JSON.stringify(S());");
    await page.getByLabel("Search all sounds", { exact: true }).fill("grand piano");
    await page.getByLabel("Sound source", { exact: true }).selectOption("recorded");
    await page.getByLabel("Sample pack", { exact: true }).selectOption("Versilian");
    await expect(page.locator(".item-name")).toHaveText(["Kawai Grand Piano", "Steinway Close Piano"]);
    expect(recordings).toEqual([]);
    const piano = page.locator(".item", { hasText: "Kawai Grand Piano" });
    await piano.locator(".item-play").click();
    await expect.poll(() => ev(page, "return t.audio().bank.has('THK_Library_piano_Kawai_Grand_Piano');")).toBe(true);
    expect(recordings.length).toBeGreaterThan(1);
    await piano.getByRole("button", { name: "Use", exact: true }).click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Library_piano_Kawai_Grand_Piano");
    await page.click("#undoBtn");
    expect(await ev(page, "return JSON.stringify(S());")).toBe(original);
    await page.getByLabel("Search all sounds", { exact: true }).fill("no such instrument xyz");
    await expect(page.getByText("No matching sounds", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("70 sounds");
    expect(errors).toEqual([]);
  });

  test("previews a recorded vocal phrase at its original speed and assigns it to a drum pad", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.getByLabel("Search all sounds", { exact: true }).fill("check this out");
    await page.getByLabel("Sound source", { exact: true }).selectOption("recorded");
    await expect(page.locator(".item-name")).toHaveText(["Microlag Vocal Check This Out"]);
    await ev(
      page,
      `window.__vocalRates = []; const engine=t.audio().engine, trigger=engine.trigger.bind(engine); engine.trigger=(...args)=>{if(args[1]==='THK_Library_vocal_Microlag_Vocal_Check_This_Out')window.__vocalRates.push(args[3].rate);return trigger(...args);};`,
    );
    const vocal = page.locator(".item", { hasText: "Microlag Vocal Check This Out" });
    await vocal.locator(".item-play").click();
    await expect.poll(() => page.evaluate("window.__vocalRates.at(-1)")).toBe(1);
    await page.locator(".clip", { hasText: "Main groove" }).first().click();
    await page.locator('.pad-row[data-row="7"] .pad-n').click();
    await vocal.getByRole("button", { name: "Use", exact: true }).click();
    expect(await ev(page, "return find('Tops').pads[7];")).toBe("THK_Library_vocal_Microlag_Vocal_Check_This_Out");
    await page.click("#undoBtn");
    expect(await ev(page, "return find('Tops').pads[7];")).not.toBe("THK_Library_vocal_Microlag_Vocal_Check_This_Out");
    expect(errors).toEqual([]);
  });

  test("browses every populated group and remembers categories", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    const groups = page.getByRole("group", { name: "Instrument group", exact: true });
    await expect(groups.getByRole("button")).toHaveText([
      "Drums",
      "Bass",
      "Keys",
      "Synths",
      "Acoustic",
      "Vocals",
      "FX",
    ]);
    await groups.getByRole("button", { name: "Keys", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("11 sounds");
    await expect(page.locator("#blist")).toContainText("Classic Dance Piano");
    await page.getByRole("button", { name: "Electric pianos", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("9 sounds");
    await page.getByRole("button", { name: "Organs", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("11 sounds");
    await page.getByRole("button", { name: "Bells & mallets", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("12 sounds");
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("48 sounds");
    await groups.getByRole("button", { name: "Acoustic", exact: true }).click();
    await expect(page.getByRole("group", { name: "Sound category", exact: true }).getByRole("button")).toHaveText([
      "Strings",
      "Brass",
      "Guitars",
    ]);
    await expect(page.locator("#catCount")).toHaveText("10 sounds");
    await groups.getByRole("button", { name: "FX", exact: true }).click();
    await page.getByRole("button", { name: "Atmospheres", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("6 sounds");
    await page.getByRole("button", { name: "Transitions", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("8 sounds");
    await groups.getByRole("button", { name: "Drums", exact: true }).click();
    await page.getByRole("button", { name: "Crashes & cymbals", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("23 sounds");
    await groups.getByRole("button", { name: "Keys", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chords", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("previews both real recorded guitars, assigns them and exports a guitar phrase", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page
      .getByRole("group", { name: "Instrument group", exact: true })
      .getByRole("button", { name: "Acoustic", exact: true })
      .click();
    await page.getByRole("button", { name: "Guitars", exact: true }).click();
    await expect(page.locator(".item-name").nth(0)).toHaveText("Recorded Acoustic Guitar");
    await expect(page.locator(".item-name").nth(1)).toHaveText("Recorded Electric Guitar");
    for (const [name, id] of [
      ["Recorded Acoustic Guitar", "THK_RecordedGuitar_01_Acoustic"],
      ["Recorded Electric Guitar", "THK_RecordedGuitar_02_Electric"],
    ]) {
      const item = page.locator(".item", { hasText: name });
      await item.locator(".item-play").click();
      await expect.poll(() => ev(page, `return t.audio().bank.has('${id}');`)).toBe(true);
      await expect(item.locator(".item-meta")).toContainText("recorded guitar");
      expect(await ev(page, `return t.audio().bank.resolve('${id}',2,1,0).rate;`)).toBe(1);
      await item.getByRole("button", { name: "Use", exact: true }).click();
      expect(await ev(page, "return find('Bass').sample;")).toBe(id);
      await page.click("#undoBtn");
    }
    const exported = await ev<{ peak: number; bytes: number }>(
      page,
      `
      const song = t.song.emptySong();
      song.tracks = [{...find('Bass'), sample:'THK_RecordedGuitar_01_Acoustic', clips:[t.song.makeClip(0,1,1,[t.song.N(0,4,48)])]}];
      const result = await t.buildExport(song);
      let peak = 0; for(const x of result.buffer.getChannelData(0)) peak=Math.max(peak,Math.abs(x));
      return {peak,bytes:result.zip.length};
    `,
    );
    expect(exported.peak).toBeGreaterThan(0.01);
    expect(exported.peak).toBeLessThan(1);
    expect(exported.bytes).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  test("previews acoustic guitars, assigns a chord and keeps its voicing when copied", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page
      .getByRole("group", { name: "Instrument group", exact: true })
      .getByRole("button", { name: "Acoustic", exact: true })
      .click();
    await page.getByRole("button", { name: "Guitars", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("23 sounds");
    const original = await ev(page, "return JSON.stringify(S());");
    await page.getByTitle("Play Acoustic Nylon Fingerpick", { exact: true }).click();
    await expect
      .poll(() => ev(page, "return t.audio().bank.has('THK_Guitar_07_Acoustic_Nylon_Fingerpick');"))
      .toBe(true);
    expect(await ev(page, "return JSON.stringify(S());")).toBe(original);
    const chord = page.locator(".item", { hasText: "Acoustic Major Chord" });
    await chord.getByRole("button", { name: "Use", exact: true }).click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Guitar_16_Acoustic_Major_Chord");
    await page.click("#undoBtn");
    expect(await ev(page, "return JSON.stringify(S());")).toBe(original);
    await chord.getByRole("button", { name: "Copy", exact: true }).click();
    const maker = page.getByTestId("sound-maker");
    await expect(maker.getByLabel("Chord voicing", { exact: true })).toHaveValue("major_open");
    await maker.getByRole("button", { name: "Save sound", exact: true }).click();
    expect(await ev(page, "return [S().sounds[0].kind, S().sounds[0].patch.chord];")).toEqual(["guitar", "major_open"]);
    expect(errors).toEqual([]);
  });

  test("previews and assigns the new piano and crash presets with undo", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    const groups = page.getByRole("group", { name: "Instrument group", exact: true });
    await groups.getByRole("button", { name: "Keys", exact: true }).click();
    await page.getByTitle("Play Classic Dance Piano", { exact: true }).click();
    const piano = page.locator(".item", { hasText: "Classic Dance Piano" });
    await piano.getByRole("button", { name: "Use", exact: true }).click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Piano_01_Classic_Dance_Piano");
    await page.click("#undoBtn");
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Bass_02_Rolling_Saw_Pluck_C");
    await page.locator(".clip", { hasText: "Main groove" }).first().click();
    await page.locator('.pad-row[data-row="7"] .pad-n').click();
    await expect(page.locator("#target")).toContainText("Tops, pad 8");
    await groups.getByRole("button", { name: "Drums", exact: true }).click();
    await page.getByRole("button", { name: "Crashes & cymbals", exact: true }).click();
    await page.getByTitle("Play Bright House Crash", { exact: true }).click();
    await page
      .locator(".item", { hasText: "Bright House Crash" })
      .getByRole("button", { name: "Use", exact: true })
      .click();
    expect(await ev(page, "return find('Tops').pads[7];")).toBe("THK_Crash_01_Bright_House_Crash");
    await page.click("#undoBtn");
    expect(await ev(page, "return find('Tops').pads[7];")).not.toBe("THK_Crash_01_Bright_House_Crash");
    expect(errors).toEqual([]);
  });

  test("auditions and assigns chords and vocals, edits their synthesis controls and reloads the saved sounds", async ({
    page,
  }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    const groups = page.getByRole("group", { name: "Instrument group", exact: true });
    await groups.getByRole("button", { name: "Keys", exact: true }).click();
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    await page.getByTitle("Play Deep Minor Seven", { exact: true }).click();
    await page
      .locator(".item", { hasText: "Deep Minor Seven" })
      .getByRole("button", { name: "Use", exact: true })
      .click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Chord_01_Deep_Minor_Seven");
    await page
      .locator(".item", { hasText: "Deep Minor Seven" })
      .getByRole("button", { name: "Copy", exact: true })
      .click();
    const maker = page.getByTestId("sound-maker");
    await maker.getByLabel("Chord voicing", { exact: true }).selectOption("major7");
    await maker.getByRole("button", { name: "Save sound", exact: true }).click();
    expect(await ev(page, "return S().sounds[0].patch.chord;")).toBe("major7");
    await maker.getByRole("button", { name: "Close", exact: true }).click();
    await groups.getByRole("button", { name: "Vocals", exact: true }).click();
    await expect(page.locator(".browser-category")).toContainText("Recorded vocal phrases");
    await expect(page.locator("#catCount")).toHaveText("24 sounds");
    await page.getByTitle("Play Ah Chop", { exact: true }).click();
    await page.locator(".item", { hasText: "Ah Chop" }).getByRole("button", { name: "Use", exact: true }).click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Vocal_01_Ah_Chop");
    await page.locator(".item", { hasText: "Ah Chop" }).getByRole("button", { name: "Copy", exact: true }).click();
    await maker.getByLabel("Vowel", { exact: true }).selectOption("oo");
    await maker.getByRole("button", { name: "Save sound", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("25 sounds");
    const before = await ev(
      page,
      "return S().sounds.map(s => [s.kind, s.patch.chord ?? null, s.patch.vowel ?? null]);",
    );
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("thk-studio-song-v1") ?? "{}").sounds?.length))
      .toBe(2);
    await page.reload();
    expect(
      await ev(page, "return S().sounds.map(s => [s.kind, s.patch.chord ?? null, s.patch.vowel ?? null]);"),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });

  test("filters the house chord pack, previews higher octaves and saves the new keyboard controls", async ({
    page,
  }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.getByRole("button", { name: "Keys", exact: true }).click();
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("48 sounds");
    const styles = page.getByRole("group", { name: "Chord style", exact: true });
    await styles.getByRole("button", { name: "Piano house", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("5 sounds");
    await expect(page.locator(".item")).toHaveCount(5);
    await expect(page.locator("#blist")).toContainText("Classic Club Piano");
    await expect(page.getByLabel("Chord preview octave")).toHaveValue("48");
    const original = await ev(page, "return JSON.stringify(S());");
    await ev(
      page,
      `window.__auditionRates = []; const engine = t.audio().engine, trigger = engine.trigger.bind(engine); engine.trigger = (...args) => { if (args[3]?.choke === 'aud') window.__auditionRates.push(args[3].rate); return trigger(...args); };`,
    );
    await page.getByLabel("Chord preview octave").selectOption("60");
    await page.getByTitle("Play Classic Club Piano", { exact: true }).click();
    await expect.poll(() => page.evaluate("window.__auditionRates.at(-1)")).toBe(4);
    expect(await ev(page, "return JSON.stringify(S());")).toBe(original);
    await page
      .locator(".item", { hasText: "Classic Club Piano" })
      .getByRole("button", { name: "Copy", exact: true })
      .click();
    const maker = page.getByTestId("sound-maker");
    await expect(maker.getByLabel("FM attack decay", { exact: true })).toBeVisible();
    await maker.getByLabel("Chord voicing", { exact: true }).selectOption("minor9");
    await maker.getByRole("button", { name: "Save sound", exact: true }).click();
    expect(
      await ev(page, "return [S().sounds[0].family, S().sounds[0].patch.chord, S().sounds[0].patch.fmDecay];"),
    ).toEqual(["piano", "minor9", 0.08]);
    await maker.getByRole("button", { name: "Close", exact: true }).click();
    await styles.getByRole("button", { name: "Tech house", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("5 sounds");
    await expect(page.locator("#blist")).toContainText("Classic Tech Stab");
    await page
      .locator(".item", { hasText: "Classic Tech Stab" })
      .getByRole("button", { name: "Use", exact: true })
      .click();
    expect(await ev(page, "return find('Bass').sample;")).toBe("THK_Chord_39_Classic_Tech_Stab");
    await styles.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.locator("#catCount")).toHaveText("49 sounds");
    expect(errors).toEqual([]);
  });

  test("make a bass, shape it, save it onto the selected track: one undo step, kept in My sounds", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.getByRole("button", { name: "Bass", exact: true }).click();
    await page.getByTitle("Make a new sound in the sound maker").click();
    const maker = page.getByTestId("sound-maker");
    await expect(maker).toBeVisible();
    await expect(maker.getByLabel("Instrument")).toHaveValue("bass");
    await expect.poll(() => maker.locator("canvas").getAttribute("data-rendered")).not.toBe("0");
    await maker.getByLabel("Sound name").fill("Night Bass");
    const cutoff = maker.getByLabel("Cutoff", { exact: true });
    const before = await ev<number>(page, "return t.get().maker.draft.patch.cutoff;");
    await cutoff.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
    expect(await ev<number>(page, "return t.get().maker.draft.patch.cutoff;")).toBeLessThan(before);
    await ev(page, "t.select({ tid: find('Bass').id });");
    await maker.getByRole("button", { name: "Save and use on Bass" }).click();
    expect(
      await ev(page, "return [S().sounds.map(s => s.id), find('Bass').sample, t.get().history.past.length];"),
    ).toEqual([["user_night_bass"], "user_night_bass", 1]);
    await expect.poll(() => ev(page, "return !!t.audio().bank.get('user_night_bass');")).toBe(true);
    await expect(page.locator("#blist .label.mine").first()).toHaveText("My sounds");
    expect(await ev(page, "return JSON.parse(localStorage.getItem('thk-studio-sounds-v1')).map(s => s.id);")).toEqual([
      "user_night_bass",
    ]);
    await page.click("#undoBtn");
    expect(await ev(page, "return [(S().sounds || []).length, find('Bass').sample];")).toEqual([
      0,
      "THK_Bass_02_Rolling_Saw_Pluck_C",
    ]);
    expect(errors).toEqual([]);
  });

  test("copy a factory preset into an editable sound", async ({ page }) => {
    const errors: string[] = [];
    await fresh(page, errors);
    await page.getByRole("button", { name: "Synths", exact: true }).click();
    await page.getByRole("button", { name: "Leads", exact: true }).click();
    await page.locator("#blist .item").first().getByRole("button", { name: "Copy" }).click();
    const maker = page.getByTestId("sound-maker");
    await expect(maker.getByLabel("Sound name")).toHaveValue("Detuned Saw copy");
    await maker.getByRole("button", { name: "Save sound" }).click();
    expect(
      await ev(
        page,
        "const s = S().sounds[0], p = t.song.KIT.find(k => k.id === 'THK_Lead_01_Detuned_Saw'); return [s.id, s.kind, JSON.stringify(s.patch) === JSON.stringify(p.patch)];",
      ),
    ).toEqual(["user_detuned_saw_copy", "lead", true]);
    expect(errors).toEqual([]);
  });

  test("the assistant's design_sound edit is replayed in the browser", async ({ page }) => {
    const errors: string[] = [];
    await page.route("**/api/assistant", (r) =>
      r.fulfill({
        json: {
          text: "Made Rubber Acid and put it on Bass.",
          steps: [{ tool: "design_sound", ok: true, text: 'New bass "Rubber Acid" (user_rubber_acid), now on Bass' }],
          edits: [{ tool: "design_sound", input: { name: "Rubber Acid", instrument: "bass", settings: { resonance: 12, cutoff: 400 }, track: "Bass" } }],
          variations: [],
          stop: "done",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      }),
    ); // prettier-ignore
    await fresh(page, errors, true);
    await page.fill("#prompt", "a rubbery acid bass please");
    await page.keyboard.press("Enter");
    await expect(page.locator(".msg.bot").last().locator(".body")).toHaveText("Made Rubber Acid and put it on Bass.");
    expect(
      await ev(page, "const s = S().sounds[0]; return [s.id, s.patch.resonance, s.patch.cutoff, find('Bass').sample];"),
    ).toEqual(["user_rubber_acid", 12, 400, "user_rubber_acid"]);
    expect(errors).toEqual([]);
  });
});
