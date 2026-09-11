// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteAudioFile, loadAudioFile, saveAudioFile } from "./audioStore";

describe("audioStore", () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("yanxu-audio-assets");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("saves, loads, and deletes an audio file", async () => {
    const file = new File(["audio"], "sample.wav", { type: "audio/wav" });

    await saveAudioFile("recording-one", file);
    const loaded = await loadAudioFile("recording-one");

    expect(loaded).toBeInstanceOf(File);

    await deleteAudioFile("recording-one");
    await expect(loadAudioFile("recording-one")).resolves.toBeNull();
  });
});
