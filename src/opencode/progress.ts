const descriptions = {
  navigation: { label: 'Opening a page', summary: 'Page navigation' },
  page: { label: 'Checking the page', summary: 'Page checks' },
  browser: { label: 'Running a browser action', summary: 'Browser actions' },
  read: { label: 'Reading files', summary: 'File reads' },
  update: { label: 'Updating files', summary: 'File updates' },
  search: { label: 'Searching files', summary: 'File searches' },
  command: { label: 'Running a command', summary: 'Commands' },
  guidance: { label: 'Loading task guidance', summary: 'Guidance requests' },
  web: { label: 'Looking up information', summary: 'Web requests' },
  connected: { label: 'Using a connected tool', summary: 'Connected tool activity' },
} as const;
type Kind = keyof typeof descriptions;
function category(tool: string): Kind {
  const name = tool.toLowerCase();
  if (name.includes('browser')) {
    if (/(?:^|_)navigate$/.test(name)) return 'navigation';
    if (/(?:^|_)(?:resize|take_screenshot|screenshot)$/.test(name)) return 'page';
    return 'browser';
  }
  if (['read', 'read_file'].includes(name)) return 'read';
  if (['edit', 'write', 'apply_patch', 'patch', 'multiedit'].includes(name)) return 'update';
  if (['glob', 'grep', 'find', 'search'].includes(name)) return 'search';
  if (['shell', 'bash', 'powershell', 'exec'].includes(name)) return 'command';
  if (name === 'skill') return 'guidance';
  if (['websearch', 'web_search', 'webfetch', 'web_fetch'].includes(name)) return 'web';
  return 'connected';
}

// Streaming text cannot replace an earlier line in either Claude client.
// Announce a phase once, then summarize consecutive calls at a boundary.
// Counts describe observed operations, never files changed or tool success.
export class ToolProgress {
  private active: { kind: Kind; count: number; reported: number; lastUpdate: number } | undefined;
  constructor(private readonly emit: (text: string) => void, private readonly now: () => number = Date.now) {}
  tool(name: string): void {
    const kind = category(name);
    if (this.active?.kind !== kind) {
      this.flush();
      this.active = { kind, count: 1, reported: 1, lastUpdate: this.now() };
      this.emit('\n' + descriptions[kind].label + '...\n');
      return;
    }
    this.active.count++;
    if (this.now() - this.active.lastUpdate >= 30_000) this.summary();
  }
  private summary(): void {
    const group = this.active;
    if (!group || group.count <= group.reported) return;
    this.emit('\n' + descriptions[group.kind].summary + ': ' + group.count + ' operations.\n');
    group.reported = group.count;
    group.lastUpdate = this.now();
  }
  flush(): void { this.summary(); this.active = undefined; }
}
