// Pulls the trailing <replies>[...]</replies> line out of Duke's streamed text, so the app shows
// buttons instead of the tag. Text is forwarded as it comes, except anything that might be the
// start of the tag, which waits until it's clearly not.

const OPEN = "<replies>";
const CLOSE = "</replies>";

export class RepliesFilter {
  private buffer = "";
  private inTag = false;
  private tag = "";
  shown = "";

  push(delta: string): string {
    if (this.inTag) {
      this.tag += delta;
      return "";
    }
    this.buffer += delta;
    const at = this.buffer.indexOf(OPEN);
    if (at >= 0) {
      const out = this.buffer.slice(0, at);
      this.tag = this.buffer.slice(at + OPEN.length);
      this.inTag = true;
      this.buffer = "";
      this.shown += out;
      return out;
    }
    // Hold back a tail that could be the beginning of "<replies>".
    let keep = 0;
    for (let n = Math.min(OPEN.length - 1, this.buffer.length); n > 0; n--) {
      if (OPEN.startsWith(this.buffer.slice(-n))) { keep = n; break; }
    }
    const out = this.buffer.slice(0, this.buffer.length - keep);
    this.buffer = this.buffer.slice(this.buffer.length - keep);
    this.shown += out;
    return out;
  }

  finish(): { rest: string; replies: string[] } {
    const rest = this.inTag ? "" : this.buffer;
    this.shown += rest;
    let replies: string[] = [];
    if (this.inTag) {
      const raw = this.tag.split(CLOSE)[0] ?? "";
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) replies = parsed.filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 60)).slice(0, 4);
      } catch {
        replies = [];
      }
    }
    return { rest, replies };
  }
}
