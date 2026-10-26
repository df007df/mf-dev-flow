export type Feature = {
  id: string;
  ref?: string | null;
  title: string;
  kind?: "product" | "technical";
  description?: string;
  outcome?: string;
  status: string;
  priority?: string;
  wave?: string;
  priorityReason?: string;
  waveReason?: string;
  analysis?: {
    prototype: string;
    code: string;
    systems: string;
    scope: string;
    gaps: string[];
    sources: Array<{ kind: string; ref: string; note: string }>;
  };
  labelHistory?: Array<{
    at: string;
    runId: string;
    from: { priority?: string | null; wave?: string | null };
    to: { priority?: string | null; wave?: string | null };
    priorityReason: string;
    waveReason: string;
  }>;
  parentId?: string;
  rank?: number;
  dependsOn?: string[];
  sourceEntries?: string[];
  prototypeEntries?: Array<{
    id: string;
    title?: string;
    groupId?: string | null;
    evidenceCount?: number;
  }>;
  developmentRequirements?: string[];
  blockers?: string[];
  questions?: Array<{
    id: string;
    title?: string;
    question?: string;
    status?: string;
    resolution?: string;
    answer?: string;
    conclusion?: string;
    answerActor?: string;
    answeredAt?: string;
    dataFlow?: {
      lanes: { id: string; title: string }[];
      nodes: Array<{
        id: string;
        title: string;
        note?: string;
        lane: "frontend" | "backend" | "storage" | "impl";
      }>;
      edges: Array<{ from: string; to: string; label?: string }>;
    };
  }>;
  sourceScreenshots?: Array<{ path: string; entryId: string; action?: string }>;
  stages?: Record<string, {
    status?: string;
    summary?: string;
    documentation?: {
      description?: string;
      process?: Array<{ id: string; title: string; detail: string }>;
      outputs?: Array<{ id: string; title: string; detail: string }>;
    } | null;
    acceptanceCriteria?: Array<{ id: string; title: string; detail: string }>;
    acceptanceResults?: Record<string, {
      status?: "passed" | "failed" | "not_applicable";
      summary?: string;
      evidence?: string[];
      updatedAt?: string;
    }>;
    evidence?: Array<{ path: string; label?: string; action?: string }>;
    evidenceSource?: { runId?: string; taskId?: string; note?: string };
    latestRunNote?: string | null;
    mockContracts?: Array<{
      method?: string;
      url?: string | null;
      endpoint?: string | null;
      httpStatus?: number | null;
      responseFile?: string | null;
      fieldDefinitions?: Array<{ path: string; type: string }>;
      response?: unknown;
    }>;
    visualPairs?: Array<{
      id: string;
      state: string;
      action?: string;
      screenshots: Array<{ path: string; label?: string; action?: string }>;
    }>;
    visualReviews?: Array<{
      pairId: string;
      status: string;
      reviewedAt?: string | null;
      differences: Array<{
        regionId: string;
        kind: string;
        status: string;
        detail: string;
      }>;
    }>;
  }>;
  history?: Array<{
    id: string;
    type?: string;
    at?: string;
    runId?: string;
    runTitle?: string;
    taskId?: string;
    taskTitle?: string;
    phase?: string;
    taskStatus?: string;
    summary?: string;
    blocker?: string;
    decision?: string;
    stage?: { id?: string; title?: string; status?: string; summary?: string } | null;
    verification?: { status?: string; commands?: string } | null;
  }>;
  historySummary?: {
    taskCount?: number;
    eventCount?: number;
    blockerCount?: number;
  };
};

export type Planning = {
  sourceRun?: string;
  updatedAt?: string;
  features: Feature[];
  groups: Array<{ id: string; ref?: string | null; title: string; rank?: number }>;
  actionable: Feature[];
  prototypeImpact?: {
    status?: string;
    global?: boolean;
    changedGroupIds?: string[];
    changedEntryIds?: string[];
    affected?: Array<{ id: string; status?: string; reasons?: string[] }>;
    problems?: string[];
  };
  content?: string;
};

export type DashboardState = {
  generatedAt: string;
  project?: {
    ref?: string | null;
    project?: { name?: string; background?: string };
    prototype?: { location?: string };
  };
  current: { active?: { type: string; id: string } | null };
  summary: { runs: number; activeRuns: number; tasks: Record<string, number> };
  prototype?: Record<string, any> & { groups?: PrototypeGroup[] };
  planning?: Planning;
  prd?: Record<string, any> | null;
  system?: Record<string, any>;
  projectCards: Array<Record<string, any>>;
  runs: Array<Record<string, any>>;
};

export type PrototypeGroup = {
  id: string;
  ref?: string | null;
  title: string;
  screenshotCount: number;
  unavailableScreenshotCount: number;
  questions: {
    total: number;
    open: number;
    resolved: number;
    answers: number;
    status: "open" | "resolved" | "none" | "unverified";
  };
};

export type RunDetail = Record<string, any>;

export type PrototypeDocumentPrompt = {
  groupId: string;
  groupTitle: string;
  answer: string;
  supplement: string;
};

export type SystemDocumentPrompt = {
  cardId: string;
  cardTitle: string;
  answer: string;
};
