import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity, Archive, ArrowDownRight, ArrowUpRight, BookOpen, CalendarDays, Check,
  CheckCircle2, ChevronDown, Clock3, Command, Edit3, Home, MapPin,
  MessageSquareText, MoreHorizontal, Plus, Search, Send, ShieldCheck, Sparkles,
  Trash2, Wrench, X,
} from 'lucide-react';
import {
  getGetHouseholdSummaryQueryKey,
  getListHouseholdActivityQueryKey,
  getListHouseholdMemoriesQueryKey,
  useAskHouseholdMemory,
  useCreateHouseholdMemory,
  useDeleteHouseholdMemory,
  useGetHouseholdSummary,
  useListHouseholdActivity,
  useListHouseholdMemories,
  useUpdateHouseholdMemory,
} from '@workspace/api-client-react';
import type { HouseholdAnswer, Memory, MemoryCategory, MemoryInput } from '@workspace/api-client-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
type FilterType = 'all' | MemoryCategory;

const categoryMeta: Record<MemoryCategory, { label: string; icon: typeof MapPin; tone: string }> = {
  location: { label: 'Location', icon: MapPin, tone: 'sage' },
  warranty: { label: 'Warranty', icon: ShieldCheck, tone: 'peach' },
  chore: { label: 'Chore', icon: CheckCircle2, tone: 'gold' },
  note: { label: 'Note', icon: BookOpen, tone: 'slate' },
};

function timeAgo(dateString: string) {
  const elapsed = Math.max(0, Date.now() - new Date(dateString).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function dateLabel(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogMemory, setDialogMemory] = useState<Memory | null | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<HouseholdAnswer | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpLog, setMcpLog] = useState<string[]>([]);
  const [mcpError, setMcpError] = useState('');
  const [askError, setAskError] = useState('');
  const [actor, setActor] = useState('Maya');
  const { data: memories, isLoading: memoriesLoading, isError: memoriesError, refetch: retryMemories } = useListHouseholdMemories();
  const { data: summary, isLoading: summaryLoading } = useGetHouseholdSummary();
  const { data: activities, isLoading: activityLoading, isError: activityError, refetch: retryActivity } = useListHouseholdActivity();
  const askMemory = useAskHouseholdMemory();
  const createMemory = useCreateHouseholdMemory();
  const updateMemory = useUpdateHouseholdMemory();
  const deleteMemory = useDeleteHouseholdMemory();

  const visibleMemories = useMemo(() => {
    const collection = memories ?? [];
    return collection.filter((memory) => {
      const matchesCategory = filter === 'all' || memory.category === filter;
      const normalized = searchTerm.trim().toLowerCase();
      const matchesSearch = !normalized || `${memory.title} ${memory.details} ${memory.location ?? ''} ${memory.createdBy}`.toLowerCase().includes(normalized);
      return matchesCategory && matchesSearch;
    });
  }, [memories, filter, searchTerm]);

  const refreshHousehold = () => {
    void queryClient.invalidateQueries({ queryKey: getListHouseholdMemoriesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetHouseholdSummaryQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListHouseholdActivityQueryKey() });
  };

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAskError('');
    setAnswer(null);
    askMemory.mutate({ data: { question: question.trim(), askedBy: actor } }, {
      onSuccess: (result) => setAnswer(result),
      onError: () => setAskError('Could not reach household memory. Please try again.'),
    });
  }

  async function runMcpDemo() {
    setMcpBusy(true);
    setMcpError('');
    setMcpLog([]);
    let protocolVersion: string | null = null;
    const log: string[] = [];
    const postRpc = async (id: number, method: string, params?: Record<string, unknown>) => {
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      });
      if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
      const raw = await response.text();
      if (!raw) return null;
      const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
      const payload = dataLine ? dataLine.slice(5).trim() : raw;
      try {
        return JSON.parse(payload);
      } catch {
        return { raw: payload };
      }
    };
    try {
      const initialize = await postRpc(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Household Memory dashboard', version: '1.0.0' },
      });
      log.push(`initialize\n${JSON.stringify(initialize, null, 2)}`);
      protocolVersion =
        (initialize as { result?: { protocolVersion?: string } } | null)?.result?.protocolVersion ?? null;
      if (!protocolVersion) throw new Error('The server did not negotiate an MCP protocol version.');
      const initializedResponse = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': protocolVersion,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      if (!initializedResponse.ok) throw new Error(`notifications/initialized returned HTTP ${initializedResponse.status}`);
      const tools = await postRpc(2, 'tools/list', {});
      log.push(`tools/list\n${JSON.stringify(tools, null, 2)}`);
      const toolList = (tools as { result?: { tools?: Array<{ name?: string }> } } | null)?.result?.tools ?? [];
      const searchTool = toolList.find((tool) => tool.name === 'search_household_memory');
      if (!searchTool) throw new Error('The server did not advertise search_household_memory.');
      const search = await postRpc(3, 'tools/call', {
        name: 'search_household_memory',
        arguments: { query: question.trim() || 'Where did we put the passport?' },
      });
      log.push(`tools/call · search_household_memory\n${JSON.stringify(search, null, 2)}`);
      setMcpLog(log);
    } catch (error) {
      setMcpLog(log);
      setMcpError(error instanceof Error ? error.message : 'MCP request failed.');
    } finally {
      setMcpBusy(false);
    }
  }

  async function removeMemory(memory: Memory) {
    if (!window.confirm(`Delete “${memory.title}” from household memory?`)) return;
    deleteMemory.mutate({ id: memory.id }, {
      onSuccess: refreshHousehold,
    });
  }

  const openCreate = () => setDialogMemory(null);
  const navItems = [
    { icon: Home, label: 'Overview', active: true },
    { icon: Archive, label: 'All memories', active: false },
    { icon: Activity, label: 'Activity', active: false },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Command size={18} strokeWidth={2.2} /></div>
          <div><div className="brand-name">keepsake</div><div className="brand-caption">HOUSEHOLD MEMORY</div></div>
        </div>
        <div className="household-switcher">
          <div className="household-avatar">H</div>
          <div className="household-switcher-copy"><strong>Hearth & home</strong><span>Shared household</span></div>
          <ChevronDown size={15} />
        </div>
        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ icon: Icon, label, active }) => (
            <button key={label} className={`nav-item ${active ? 'selected' : ''}`} type="button" onClick={() => {
              if (label === 'All memories') document.getElementById('memory-library')?.scrollIntoView({ behavior: 'smooth' });
              if (label === 'Activity') document.getElementById('activity-feed')?.scrollIntoView({ behavior: 'smooth' });
            }} data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
              <Icon size={17} /><span>{label}</span>{label === 'All memories' && <span className="nav-count">{summary?.totalMemories ?? '—'}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="sidebar-note-top"><span className="pulse-dot" /> Everything in its place</div>
            <p>A self-hosted memory hub for one household. Demo names are selected, not verified accounts.</p>
            <button type="button" className="quiet-link" onClick={() => { setMcpOpen(true); setMcpError(''); }}>Explore MCP connection <ArrowUpRight size={13} /></button>
          </div>
          <div className="member-row">
            <div className="avatar-initial">M</div>
            <div className="member-meta"><strong>{actor}</strong><span>Household member</span></div>
            <button type="button" className="icon-button member-switch" title="Switch attribution" onClick={() => setActor(actor === 'Maya' ? 'Theo' : 'Maya')}><ChevronDown size={15} /></button>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">Household <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-actions">
            <div className="secure-pill"><span className="secure-dot" /> Single-household demo</div>
            <button className="avatar-initial top-avatar" type="button" title="Switch attribution" onClick={() => setActor(actor === 'Maya' ? 'Theo' : 'Maya')}>{actor.slice(0, 1)}</button>
          </div>
        </header>

        <div className="page-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> THE HOUSEHOLD, AT HOME</div>
              <h1>Keep the little things<br className="mobile-break" /> <span>remembered.</span></h1>
              <p className="intro-copy">The details that make a household run, in one place everyone can trust.</p>
            </div>
            <button className="button-primary add-memory" onClick={openCreate} type="button" data-testid="button-add-memory"><Plus size={17} /> Add a memory</button>
          </div>

          <div className="summary-grid">
            <SummaryTile loading={summaryLoading} label="Memories saved" value={summary?.totalMemories} hint="Across your household" icon={BookOpen} tone="green" />
            <SummaryTile loading={summaryLoading} label="Things & places" value={summary?.locations} hint="Find it when you need it" icon={MapPin} tone="blue" />
            <SummaryTile loading={summaryLoading} label="Warranties" value={summary?.warranties} hint="Receipts, dates & details" icon={ShieldCheck} tone="peach" />
            <SummaryTile loading={summaryLoading} label="Chores to keep up" value={summary?.chores} hint={summary?.nextChore ? `Next: ${summary.nextChore}` : 'No upcoming chores'} icon={CheckCircle2} tone="gold" />
          </div>

          <div className="main-columns">
            <section className="memory-column" id="memory-library">
              <div className="section-heading">
                <div><div className="section-overline">THE SHARED REFERENCE</div><h2>Memory shelf</h2></div>
                <div className="shelf-meta"><span className="shelf-live-dot" /> {summaryLoading ? 'Syncing' : `${summary?.totalMemories ?? memories?.length ?? 0} saved`}</div>
              </div>
              <div className="memory-toolbar">
                <div className="filter-tabs" role="tablist" aria-label="Filter memories">
                  {(['all', 'location', 'warranty', 'chore', 'note'] as FilterType[]).map((item) => (
                    <button key={item} type="button" role="tab" aria-selected={filter === item} className={`filter-tab ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)} data-testid={`filter-${item}`}>
                      {item === 'all' ? 'All' : categoryMeta[item].label}
                    </button>
                  ))}
                </div>
                <label className="search-field"><Search size={15} /><input aria-label="Search memories" data-testid="input-search-memories" placeholder="Search memories" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /><kbd>⌘ K</kbd></label>
              </div>
              {memoriesLoading ? <MemorySkeleton /> : memoriesError ? (
                <div className="state-panel error-panel"><span className="state-icon"><Archive size={19} /></span><strong>Memories could not load</strong><p>Your saved facts are still safe. Try connecting again.</p><button className="button-secondary" type="button" onClick={() => void retryMemories()}>Retry connection</button></div>
              ) : visibleMemories.length === 0 ? (
                <div className="state-panel empty-panel"><span className="empty-mark"><BookOpen size={21} /></span><strong>{searchTerm || filter !== 'all' ? 'No matching memories' : 'A clear shelf, for now.'}</strong><p>{searchTerm || filter !== 'all' ? 'Try another search or category.' : 'Save a household detail and everyone can find it later.'}</p>{!searchTerm && filter === 'all' && <button className="button-primary" type="button" onClick={openCreate}><Plus size={15} /> Add your first memory</button>}</div>
              ) : (
                <div className="memory-list">
                   {visibleMemories.map((memory) => <MemoryRow key={memory.id} memory={memory} onEdit={() => setDialogMemory(memory)} onDelete={() => void removeMemory(memory)} onToggle={() => updateMemory.mutate({ id: memory.id, data: { status: memory.status === 'done' ? 'active' : 'done', actor } }, { onSuccess: refreshHousehold })} pending={updateMemory.isPending || deleteMemory.isPending} />)}
                </div>
              )}
              <div className="shelf-footer"><span><span className="provenance-mark">i</span> Every memory shows who added it and when.</span><span className="shelf-footer-right">A little more room to remember.</span></div>
            </section>

            <aside className="right-rail">
              <section className="ask-card">
                <div className="ask-card-top">
                  <div className="assistant-mark"><Sparkles size={16} /></div>
                  <div><div className="assistant-kicker">ALEXA+ DEMO CLIENT</div><h2>Ask Keepsake</h2></div>
                  <span className="online-indicator" title="Ready"><span /></span>
                </div>
                <p className="ask-description">A simulated Alexa+ conversation, grounded in the things your household has saved.</p>
                <div className="suggested-questions">
                  <button type="button" onClick={() => setQuestion('Where did we put the passport?')}>“Where did we put the passport?” <ArrowDownRight size={13} /></button>
                  <button type="button" onClick={() => setQuestion('What needs doing this week?')}>“What needs doing this week?” <ArrowDownRight size={13} /></button>
                </div>
                <form className="ask-form" onSubmit={submitQuestion}>
                  <input aria-label="Ask a household question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about something at home…" data-testid="input-household-question" />
                  <button className="ask-send" type="submit" aria-label="Send question" disabled={!question.trim() || askMemory.isPending} data-testid="button-ask"><Send size={15} /></button>
                </form>
                <div className="ask-byline"><span className="mini-avatar">{actor.slice(0, 1)}</span> Asking as <strong>{actor}</strong><span className="byline-separator">·</span> answers cite saved memories</div>
                {askMemory.isPending && <div className="answer-pending"><span className="typing-dots"><i /><i /><i /></span> Checking the household shelf…</div>}
                {askError && <div className="inline-error" role="alert">{askError}</div>}
                {answer && <AnswerCard answer={answer} />}
                <button className="mcp-launch" type="button" onClick={() => { setMcpOpen(true); setMcpError(''); }}><span className="mcp-icon">M</span><span><strong>Try the MCP connection</strong><small>See how a home assistant can search</small></span><ArrowUpRight size={15} /></button>
              </section>

              <section className="activity-card" id="activity-feed">
                <div className="activity-heading"><div><div className="section-overline">THE HOUSEHOLD LOG</div><h2>Recent activity</h2></div><button type="button" className="icon-button" aria-label="Refresh activity" onClick={() => void retryActivity()}><MoreHorizontal size={19} /></button></div>
                {activityLoading ? <ActivitySkeleton /> : activityError ? (
                  <div className="activity-error"><p>Activity is taking a moment.</p><button type="button" onClick={() => void retryActivity()}>Try again</button></div>
                ) : activities?.length ? (
                  <div className="activity-list">
                    {activities.slice(0, 5).map((entry) => <ActivityRow key={entry.id} activity={entry} />)}
                  </div>
                ) : (
                  <div className="activity-empty"><span><Activity size={17} /></span><p>When someone adds or updates a memory, it’ll show up here.</p></div>
                )}
                <div className="activity-footnote"><span className="activity-footnote-icon"><Clock3 size={13} /></span> Changes stay visible to everyone.</div>
              </section>
            </aside>
          </div>
          <footer className="page-footer"><span>KEEPSAKE <span className="footer-sep">/</span> YOUR HOUSEHOLD, YOUR MEMORY</span><span>Self-hosted MCP · Streamable HTTP</span></footer>
        </div>
      </section>

      {dialogMemory !== undefined && <MemoryDialog memory={dialogMemory} actor={actor} busy={createMemory.isPending || updateMemory.isPending} onClose={() => setDialogMemory(undefined)} onSave={(payload) => {
        if (dialogMemory) {
          updateMemory.mutate({ id: dialogMemory.id, data: { ...payload, actor } }, { onSuccess: () => { refreshHousehold(); setDialogMemory(undefined); } });
        } else {
          createMemory.mutate({ data: payload as MemoryInput }, { onSuccess: () => { refreshHousehold(); setDialogMemory(undefined); } });
        }
      }} />}
        {mcpOpen && <McpDialog busy={mcpBusy} log={mcpLog} error={mcpError} question={question} onClose={() => setMcpOpen(false)} onRun={() => void runMcpDemo()} />}
    </main>
  );
}

function SummaryTile({ loading, label, value, hint, icon: Icon, tone }: { loading: boolean; label: string; value?: number; hint: string; icon: typeof MapPin; tone: string }) {
  return <article className={`summary-tile tone-${tone}`} data-testid={`summary-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="tile-top"><span className="tile-label">{label}</span><span className="tile-icon"><Icon size={16} /></span></div>
    {loading ? <div className="skeleton-number" /> : <div className="tile-value">{value ?? 0}</div>}
    <div className="tile-hint">{hint}</div>
  </article>;
}

function MemoryRow({ memory, onEdit, onDelete, onToggle, pending }: { memory: Memory; onEdit: () => void; onDelete: () => void; onToggle: () => void; pending: boolean }) {
  const meta = categoryMeta[memory.category];
  const Icon = meta.icon;
  return <article className={`memory-row ${memory.status === 'done' ? 'is-done' : ''}`} data-testid={`memory-${memory.id}`}>
    <button className={`memory-category-icon ${meta.tone}`} onClick={onToggle} type="button" title={memory.category === 'chore' ? (memory.status === 'done' ? 'Mark active' : 'Mark done') : meta.label} aria-label={memory.category === 'chore' ? (memory.status === 'done' ? 'Mark active' : 'Mark done') : meta.label} disabled={pending || memory.category !== 'chore'}><Icon size={17} /></button>
    <div className="memory-main">
      <div className="memory-titleline"><h3>{memory.title}</h3><span className={`category-tag ${meta.tone}`}>{meta.label}</span>{memory.status === 'done' && <span className="done-tag"><Check size={11} /> Done</span>}</div>
      <p className="memory-details">{memory.details}</p>
      <div className="memory-meta">
        {memory.location && <span className="metadata-item"><MapPin size={12} /> {memory.location}</span>}
        {memory.dueDate && <span className="metadata-item"><CalendarDays size={12} /> {dateLabel(memory.dueDate)}</span>}
        {memory.recurrence && <span className="metadata-item"><Wrench size={12} /> {memory.recurrence}</span>}
        <span className="created-by"><span className="member-dot">{memory.createdBy.slice(0, 1).toUpperCase()}</span> Added by <strong>{memory.createdBy}</strong> <span className="metadata-divider">·</span> {timeAgo(memory.createdAt)}</span>
      </div>
    </div>
    <div className="memory-controls"><button className="icon-button" type="button" onClick={onEdit} aria-label={`Edit ${memory.title}`} data-testid={`edit-memory-${memory.id}`}><Edit3 size={15} /></button><button className="icon-button delete-control" type="button" onClick={onDelete} aria-label={`Delete ${memory.title}`} data-testid={`delete-memory-${memory.id}`}><Trash2 size={15} /></button></div>
  </article>;
}

function ActivityRow({ activity }: { activity: { id: string; action: string; actor: string; summary: string; memoryTitle: string; occurredAt: string } }) {
  const actionText = activity.action === 'created' ? 'added a memory' : activity.action === 'completed' ? 'completed a chore' : activity.action === 'deleted' ? 'removed a memory' : 'updated a detail';
  return <article className="activity-row" data-testid={`activity-${activity.id}`}>
    <div className={`activity-avatar action-${activity.action}`}>{activity.actor.slice(0, 1).toUpperCase()}</div>
    <div className="activity-copy"><div><strong>{activity.actor}</strong> {actionText}</div><p>{activity.summary || activity.memoryTitle}</p><time>{timeAgo(activity.occurredAt)}</time></div>
     <span className={`activity-action-mark action-${activity.action}`}>{activity.action === 'completed' ? <Check size={12} /> : activity.action === 'created' ? <Plus size={12} /> : activity.action === 'deleted' ? <Trash2 size={12} /> : <Edit3 size={11} />}</span>
  </article>;
}

function AnswerCard({ answer }: { answer: HouseholdAnswer }) {
  return <div className="answer-card" data-testid="answer-household">
    <div className="answer-label"><Sparkles size={13} /> KEEPSAKE FOUND</div>
    <p>{answer.answer}</p>
    {!!answer.sources?.length && <div className="answer-sources"><span>From your shelf</span>{answer.sources.map((source) => <div key={source.id} className="answer-source"><span className="source-dot" /> <strong>{source.title}</strong><small>{source.createdBy} · {categoryMeta[source.category].label}</small></div>)}</div>}
    <time>{timeAgo(answer.answeredAt)}</time>
  </div>;
}

function MemoryDialog({ memory, actor, busy, onClose, onSave }: { memory: Memory | null; actor: string; busy: boolean; onClose: () => void; onSave: (data: MemoryInput | Partial<MemoryInput>) => void }) {
  const [title, setTitle] = useState(memory?.title ?? '');
  const [details, setDetails] = useState(memory?.details ?? '');
  const [category, setCategory] = useState<MemoryCategory>(memory?.category ?? 'location');
  const [location, setLocation] = useState(memory?.location ?? '');
  const [dueDate, setDueDate] = useState(memory?.dueDate?.slice(0, 10) ?? '');
  const [recurrence, setRecurrence] = useState(memory?.recurrence ?? '');
  const [formError, setFormError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !details.trim()) { setFormError('Add a title and a detail before saving.'); return; }
    const fields = { title: title.trim(), details: details.trim(), category, location: location.trim() || null, dueDate: dueDate || null, recurrence: recurrence.trim() || null };
    onSave(memory ? fields : { ...fields, createdBy: actor });
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-dialog-title">
      <div className="dialog-heading"><div><div className="section-overline">{memory ? 'KEEP IT CURRENT' : 'ADD TO THE HOUSEHOLD'}</div><h2 id="memory-dialog-title">{memory ? 'Edit memory' : 'Save a memory'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      <p className="dialog-intro">{memory ? 'Make a change everyone can see.' : 'A small detail now can save everyone time later.'}</p>
      <form className="memory-form" onSubmit={submit}>
        <label>What should we remember?<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Spare keys" maxLength={120} data-testid="input-memory-title" /></label>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} data-testid="select-memory-category">{Object.entries(categoryMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
        <label>Details<textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="The useful specifics…" rows={3} data-testid="input-memory-details" /></label>
        <div className="form-two-col">
          <label>{category === 'chore' ? 'Due date' : 'Where is it?'}{category === 'chore' ? <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} data-testid="input-memory-due-date" /> : <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Hall closet" data-testid="input-memory-location" />}</label>
          <label>{category === 'chore' ? 'Repeats' : 'Due date'}{category === 'chore' ? <input value={recurrence} onChange={(event) => setRecurrence(event.target.value)} placeholder="e.g. Every Sunday" data-testid="input-memory-recurrence" /> : <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} data-testid="input-memory-due-date-secondary" />}</label>
        </div>
         <div className="provenance-preview"><span className="avatar-initial">{actor.slice(0, 1)}</span><span>{memory ? <>This edit will be attributed to <strong>{actor}</strong>. Your household can see the change.</> : <>This will be saved as <strong>{actor}</strong>. Your household can see who added it.</>}</span></div>
        {formError && <div className="inline-error" role="alert">{formError}</div>}
        <div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button-primary" disabled={busy} data-testid="button-save-memory">{busy ? 'Saving…' : memory ? 'Save changes' : 'Save memory'} <ArrowUpRight size={14} /></button></div>
      </form>
    </section>
  </div>;
}

function McpDialog({ busy, log, error, question, onClose, onRun }: { busy: boolean; log: string[]; error: string; question: string; onClose: () => void; onRun: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
      <div className="dialog-heading"><div><div className="section-overline">MODEL CONTEXT PROTOCOL</div><h2 id="mcp-title">A home assistant, connected.</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close MCP demo"><X size={18} /></button></div>
      <p className="dialog-intro">Run the protocol handshake against your own MCP endpoint. We’ll initialize, discover tools, then search household memory.</p>
      <div className="mcp-endpoint"><span className="endpoint-led" /> <span>POST</span> <code>/api/mcp</code><span className="endpoint-private">LOCAL HOUSEHOLD</span></div>
      <div className="mcp-steps">
        <div className={`mcp-step ${log.some((line) => line.startsWith('initialize')) ? 'step-done' : ''}`}><span>01</span><div><strong>Initialize connection</strong><small>JSON-RPC · protocol negotiation</small></div><Check size={15} /></div>
        <div className={`mcp-step ${log.some((line) => line.startsWith('tools/list')) ? 'step-done' : ''}`}><span>02</span><div><strong>Discover available tools</strong><small>JSON-RPC · tools/list</small></div><Check size={15} /></div>
        <div className={`mcp-step ${log.some((line) => line.startsWith('tools/call')) ? 'step-done' : ''}`}><span>03</span><div><strong>Search household memory</strong><small>JSON-RPC · tools/call</small></div><Check size={15} /></div>
      </div>
      <div className="session-indicator"><span className="pulse-dot" /> Sessionless Streamable HTTP · no session token</div>
      {error && <div className="inline-error mcp-inline-error" role="alert">{error}</div>}
      {!!log.length && <div className="mcp-output" aria-live="polite">{log.map((line) => <pre key={line}>{line}</pre>)}</div>}
      <div className="dialog-actions mcp-actions"><span className="mcp-query-caption">{question.trim() ? 'Uses the question currently in the assistant box.' : 'Runs a general household search.'}</span><button type="button" className="button-primary" onClick={onRun} disabled={busy} data-testid="button-run-mcp">{busy ? <><span className="button-loader" /> Running protocol…</> : <><PlayIcon /> Run protocol test</>}</button></div>
    </section>
  </div>;
}

function PlayIcon() {
  return <span className="play-icon" aria-hidden="true">↗</span>;
}

function MemorySkeleton() {
  return <div className="memory-list skeleton-list" aria-label="Loading memories">{[0, 1, 2].map((item) => <div className="memory-skeleton" key={item}><span /><div><i /><i /><i /></div></div>)}</div>;
}

function ActivitySkeleton() {
  return <div className="activity-skeleton" aria-label="Loading household activity">{[0, 1, 2].map((item) => <div key={item}><i /><span /><b /></div>)}</div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

export default App;
