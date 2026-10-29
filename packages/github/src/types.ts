export interface GitHubRemote {
  owner: string;
  repo: string;
}

export interface GitHubDetails {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prCreatedAt: string;
  isOwnPr: boolean;
  headSha: string;
  commentCount: number;
}

export interface PulledThreadComment {
  body: string;
  authorName: string;
  authorType: 'user' | 'agent';
  createdAt: string;
}

export interface PulledThread {
  filePath: string;
  side: 'old' | 'new';
  startLine: number;
  endLine: number;
  comments: PulledThreadComment[];
}

export interface PrComment {
  filePath: string;
  side: 'LEFT' | 'RIGHT';
  startLine: number | null;
  endLine: number;
  body: string;
}

export interface PushResult {
  pushed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface PrStatus {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export interface PrListItem {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
  commentCount: number;
  labels: { name: string; color: string }[];
  status: PrStatus;
}

export interface PrTeam {
  slug: string;
  name: string;
}

export interface PrListResponse {
  viewer: string | null;
  org: string | null;
  teams: PrTeam[];
  sections: { id: string; title: string; items: PrListItem[] }[];
}
