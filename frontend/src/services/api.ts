// ─── SecureEscrow API Service Layer ────────────────────────────────────────
//
// Single centralized place for every call to the existing Express backend.
// No component should call fetch() directly — everything goes through here.
//
// Base URL is configurable via VITE_API_BASE_URL (see .env.example),
// defaulting to http://localhost:3000 for local development.

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:3000"
export const ESCROW_ACCOUNT_ID = "account-escrow"

export type BackendRole = "CLIENT" | "FREELANCER"
export type MilestoneStatus =
  | "CREATED" | "FUNDED" | "IN_PROGRESS" | "SUBMITTED" | "UNDER_REVIEW"
  | "APPROVED" | "RELEASED" | "CANCELLED" | "DISPUTED" | "RESOLVED" | "EXPIRED"

export interface BackendUser { id: string; name: string; type: BackendRole; createdAt: number }
export interface BackendAccount {
  id: string; userId: string | null; balance: number; currency: string
  type: "PERSONAL" | "ESCROW"; createdAt: number
}
export interface BackendEscrow {
  id: string; title: string; description: string; clientId: string; freelancerId: string
  totalAmount: number; status: string; createdAt: number; updatedAt: number
}
export interface BackendMilestone {
  id: string; escrowId: string; title: string; description: string; amount: number
  status: MilestoneStatus; order: number; createdAt: number; updatedAt: number
}
export interface BackendTransaction {
  id: string; type: "FUND" | "RELEASE" | "REFUND"; amount: number
  status: "PENDING" | "COMPLETED" | "FAILED"; escrowId: string; milestoneId: string | null
  fromAccountId: string; toAccountId: string; createdAt: number; updatedAt?: number
}
export interface BackendLedgerEntry {
  id: string; transactionId: string; accountId: string; type: "DEBIT" | "CREDIT"
  amount: number; balance: number; createdAt: number
}
export interface LedgerValidationResult {
  totalTransactions: number
  allBalanced: boolean
  results: { transactionId: string; balanced: boolean; totalDebits: number; totalCredits: number }[]
}
export interface FundOrReleaseResult { transaction: BackendTransaction; milestone: BackendMilestone }

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    })
  } catch {
    throw new ApiError(
      "Unable to reach the SecureEscrow server. Make sure the backend is running.",
      "NETWORK_ERROR",
      0,
    )
  }

  let body: any = null
  try { body = await res.json() } catch { /* e.g. 204 No Content */ }

  if (!res.ok || body?.success === false) {
    const message: string = body?.message || `Request failed with status ${res.status}`
    const code: string = body?.error || "UNKNOWN_ERROR"
    throw new ApiError(message, code, res.status, body?.details)
  }

  return (body?.data ?? body) as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined })

// ─── Users ──────────────────────────────────────────────────────────────────
export const getUsers = () => get<BackendUser[]>("/api/users")
export const getUserById = (id: string) => get<BackendUser>(`/api/users/${id}`)

// ─── Accounts ───────────────────────────────────────────────────────────────
export const getAccountByUserId = (userId: string) => get<BackendAccount>(`/api/accounts/user/${userId}`)
export const getAccountById = (accountId: string) => get<BackendAccount>(`/api/accounts/${accountId}`)
export const getAccountLedger = (accountId: string) => get<BackendLedgerEntry[]>(`/api/accounts/${accountId}/ledger`)

// ─── Escrows ────────────────────────────────────────────────────────────────
export const getEscrows = () => get<BackendEscrow[]>("/api/escrows")
export const getEscrow = (id: string) => get<BackendEscrow>(`/api/escrows/${id}`)
export const createEscrow = (data: {
  title: string; description?: string; clientId: string; freelancerId: string; totalAmount: number
}) => post<BackendEscrow>("/api/escrows", data)

// ─── Milestones ─────────────────────────────────────────────────────────────
export const getMilestonesByEscrow = (escrowId: string) => get<BackendMilestone[]>(`/api/escrows/${escrowId}/milestones`)
export const getMilestone = (id: string) => get<BackendMilestone>(`/api/milestones/${id}`)
export const createMilestone = (escrowId: string, data: { title: string; description?: string; amount: number }) =>
  post<BackendMilestone>(`/api/escrows/${escrowId}/milestones`, data)

// ─── Milestone lifecycle actions ────────────────────────────────────────────
export const fundMilestone = (escrowId: string, milestoneId: string) =>
  post<FundOrReleaseResult>(`/api/escrows/${escrowId}/fund`, { milestoneId })
export const startMilestone = (escrowId: string, milestoneId: string) =>
  post<BackendMilestone>(`/api/escrows/${escrowId}/start`, { milestoneId })
export const submitMilestone = (milestoneId: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/submit`)
export const reviewMilestone = (milestoneId: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/review`)
export const approveMilestone = (milestoneId: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/approve`)
export const releaseMilestone = (milestoneId: string) => post<FundOrReleaseResult>(`/api/milestones/${milestoneId}/release`)

// ─── Transactions & Ledger ─────────────────────────────────────────────────
export const getTransaction = (id: string) => get<BackendTransaction>(`/api/transactions/${id}`)
export const getTransactionsByEscrow = (escrowId: string) => get<BackendTransaction[]>(`/api/transactions/escrow/${escrowId}`)
export const getTransactionLedger = (transactionId: string) => get<BackendLedgerEntry[]>(`/api/transactions/${transactionId}/ledger`)
export const validateLedger = () => get<LedgerValidationResult>("/api/transactions/validation/ledger")

// ─── Aggregate helpers ──────────────────────────────────────────────────────
export interface EscrowWithMilestones extends BackendEscrow { milestones: BackendMilestone[] }

export async function getAllEscrowsWithMilestones(): Promise<EscrowWithMilestones[]> {
  const escrows = await getEscrows()
  return Promise.all(escrows.map(async escrow => ({
    ...escrow,
    milestones: await getMilestonesByEscrow(escrow.id),
  })))
}

export async function getAllTransactionsForEscrows(escrowIds: string[]): Promise<BackendTransaction[]> {
  const lists = await Promise.all(escrowIds.map(id => getTransactionsByEscrow(id)))
  return lists.flat().sort((a, b) => a.createdAt - b.createdAt)
}

export async function getAllLedgerEntriesForTransactions(transactionIds: string[]): Promise<BackendLedgerEntry[]> {
  const lists = await Promise.all(transactionIds.map(id => getTransactionLedger(id)))
  return lists.flat()
}
