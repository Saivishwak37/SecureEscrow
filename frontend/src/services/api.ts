// ─── SecureEscrow API Service Layer ────────────────────────────────────────
//
// Single centralized place for every call to the existing Express backend.
// No component should call fetch() directly — everything goes through here.
//
// Base URL is configurable via VITE_API_BASE_URL (see .env.example),
// defaulting to http://localhost:3000 for local development.

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:3000"
export const ESCROW_ACCOUNT_ID = "account-escrow"
let accessToken: string | null = null
let onUnauthorized: (() => void) | null = null
export const setAccessToken = (token: string | null) => { accessToken = token }
export const setUnauthorizedHandler = (handler: (() => void) | null) => { onUnauthorized = handler }

export type BackendRole = "CLIENT" | "PROVIDER" | "ADMIN"
export type MilestoneStatus =
  | "CREATED" | "FUNDED" | "IN_PROGRESS" | "SUBMITTED" | "UNDER_REVIEW"
  | "APPROVED" | "RELEASED" | "CANCELLED" | "DISPUTED" | "RESOLVED" | "EXPIRED"

export interface BackendUser { id: string; name: string; type: BackendRole; createdAt: number; username?: string; email?: string; role?: BackendRole; isActive?: boolean }
export interface AuthUser { id: string; username: string; email: string; role: BackendRole }
export const register = (data: { username: string; email: string; password: string; role: "CLIENT" | "PROVIDER" }) => post<AuthUser>("/api/auth/register", data)
export const login = (email: string, password: string) => post<{ accessToken: string; user: AuthUser }>("/api/auth/login", { email, password })
export const me = () => get<AuthUser>("/api/auth/me")
export const normalizeUser = (user: AuthUser): BackendUser => ({ id: user.id, name: user.username, type: user.role, role: user.role, username: user.username, email: user.email, createdAt: Date.now() })
export interface BackendCondition {
  id: string; escrowId: string; title: string; description: string; type: string
  config: Record<string, unknown>; required: boolean; status: "PENDING" | "SUBMITTED" | "REJECTED" | "SATISFIED" | "FAILED"
  satisfiedAt: number | null; satisfiedBy: string | null; verificationDetails: Record<string, unknown> | null
  createdAt: number; updatedAt: number
}
export type DisputeCategory = "NON_DELIVERY" | "INCOMPLETE_DELIVERY" | "QUALITY_ISSUE" | "PAYMENT_ISSUE" | "CONDITION_NOT_FULFILLED" | "AGREEMENT_VIOLATION" | "OTHER"
export type RequestedResolution = "RELEASE_TO_PROVIDER" | "REFUND_TO_CLIENT" | "PARTIAL_RELEASE" | "SPLIT_FUNDS" | "OTHER"
export interface BackendDispute {
  id: string; escrowId: string; milestoneId: string | null
  raisedBy: string; title: string; category: DisputeCategory; reason: string
  requestedResolution: RequestedResolution; status: string
  resolvedAt: number | null; createdAt: number; updatedAt: number
}
export interface BackendDisputeEvidence {
  id: string; disputeId: string; uploadedBy: string; type: "PDF" | "JPEG" | "PNG"; description: string
  fileName: string; mimeType: string; fileSize: number; fileHash: string; createdAt: number; downloadUrl: string
}
export interface BackendDisputeMessage {
  id: string; disputeId: string; senderId: string; message: string; createdAt: number
  sender: { id: string; name: string; type: "CLIENT" | "PROVIDER" | "ADMIN" } | null
}
export interface BackendDisputeResolution {
  id: string; disputeId: string; resolvedBy?: string; transactionId?: string | null; transactionIds?: string[]; milestoneId?: string | null
  decision: "RELEASE_TO_PROVIDER" | "REFUND_TO_CLIENT" | "SPLIT_FUNDS" | "PARTIAL_RELEASE"
  reasoning: string; executionStatus: "PENDING" | "PARTIAL" | "COMPLETED"; remainingEscrowBalance: number
  createdAt: number; allocations: { id: string; resolutionId: string; recipientAccountId: string; amount: number; currency: string; transactionId: string }[]
}
export interface BackendDisputeStatusHistory {
  id: string; disputeId: string; changedBy: string; fromStatus: string | null; toStatus: string
  reason: string; eventType: string; createdAt: number
}
export interface BackendAccount {
  id: string; userId: string | null; balance: number; currency: string
  type: "PERSONAL" | "ESCROW" | "EXTERNAL"; createdAt: number
}
export interface BackendEscrow {
  id: string; title: string; description: string; clientId: string; freelancerId: string
  totalAmount: number; status: string; createdAt: number; updatedAt: number
  releaseModel?: "MILESTONE_BASED" | "CONDITION_BASED"; releasePolicy?: "ALL_REQUIRED"; conditions?: BackendCondition[]
  agreementType?: string; terms?: string; metadata?: Record<string, unknown>; disputed?: boolean
  payerId?: string; payeeId?: string; participants?: { userId: string; role: string }[]
}
export interface BackendMilestone {
  id: string; escrowId: string; title: string; description: string; amount: number
  status: MilestoneStatus; order: number; createdAt: number; updatedAt: number
  submissions?: { attachments: { name: string; type: string; data: string }[]; submittedAt: number; submittedBy: string }[]
  reviewFeedback?: string | null
}
export interface BackendTransaction {
  id: string; type: "FUND" | "RELEASE" | "REFUND" | "DEPOSIT" | "WITHDRAWAL"; amount: number
  status: "PENDING" | "COMPLETED" | "FAILED"; escrowId: string | null; milestoneId: string | null
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
  escrowHeld?: number
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
  const publicAuthPath = path === "/api/auth/login" || path === "/api/auth/register"
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("Content-Type", "application/json")
  if (accessToken && !publicAuthPath) headers.set("Authorization", `Bearer ${accessToken}`)
  let requestBody = options.body
  if (!publicAuthPath && typeof requestBody === "string" && headers.get("Content-Type")?.includes("application/json")) {
    try { const data = JSON.parse(requestBody); delete data.actorId; delete data.role; requestBody = JSON.stringify(data) } catch { /* preserve non-JSON body */ }
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body: requestBody,
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
    if (res.status === 401) onUnauthorized?.()
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
export const loginDemoUser = (username: string, password: string) => post<BackendUser>("/api/auth/login", { username, password })

// ─── Accounts ───────────────────────────────────────────────────────────────
export const getAccountByUserId = (userId: string) => get<BackendAccount>(`/api/accounts/user/${userId}`)
export const getAccountById = (accountId: string) => get<BackendAccount>(`/api/accounts/${accountId}`)
export const getAccountLedger = (accountId: string) => get<BackendLedgerEntry[]>(`/api/accounts/${accountId}/ledger`)
export const getAccountTransactions = (accountId: string) => get<BackendTransaction[]>(`/api/accounts/${accountId}/transactions`)
const walletTransfer = (accountId: string, operation: "deposit" | "withdraw", amount: number, key: string) =>
  request<{ transaction: BackendTransaction; account: BackendAccount }>(`/api/accounts/${accountId}/${operation}`, {
    method: "POST", body: JSON.stringify({ amount }), headers: { "Idempotency-Key": key },
  })
export const depositToAccount = (accountId: string, amount: number, key: string = crypto.randomUUID()) => walletTransfer(accountId, "deposit", amount, key)
export const withdrawFromAccount = (accountId: string, amount: number, key: string = crypto.randomUUID()) => walletTransfer(accountId, "withdraw", amount, key)

// ─── Escrows ────────────────────────────────────────────────────────────────
export const getEscrows = () => get<BackendEscrow[]>("/api/escrows")
export const getEscrow = (id: string) => get<BackendEscrow>(`/api/escrows/${id}`)
export const createEscrow = (data: {
  title: string; description?: string; clientId?: string; freelancerId?: string; totalAmount: number
  releaseModel?: "MILESTONE_BASED" | "CONDITION_BASED"; conditions?: ConditionInput[]
  milestones?: { title: string; description?: string; amount: number }[]; agreementType?: string; terms?: string
  participants?: { userId: string; role: string }[]
}) => post<BackendEscrow>("/api/escrows", data)

export const getReleaseEligibility = (id: string) => get<{ eligible: boolean; reason: string | null; conditions: NonNullable<BackendEscrow["conditions"]> }>(`/api/escrows/${id}/release-eligibility`)
export interface ConditionInput { title: string; description: string; type: string; config?: Record<string, unknown>; required: boolean }
export const getConditions = (escrowId: string) => get<BackendCondition[]>(`/api/escrows/${escrowId}/conditions`)
export const createCondition = (escrowId: string, data: ConditionInput) => post<BackendCondition>(`/api/escrows/${escrowId}/conditions`, data)
export const updateCondition = (conditionId: string, data: Partial<ConditionInput>) => request<BackendCondition>(`/api/conditions/${conditionId}`, { method: "PATCH", body: JSON.stringify(data) })
export const deleteCondition = (conditionId: string) => request<{ deleted: boolean; id: string }>(`/api/conditions/${conditionId}`, { method: "DELETE" })
export const satisfyCondition = (conditionId: string, evidence?: string) => post<{ condition: BackendCondition; eligibility: { eligible: boolean; reason: string | null } }>(`/api/conditions/${conditionId}/satisfy`, { evidence })
export const reviewWorkCondition = (conditionId: string, decision: "APPROVE" | "REJECT", feedback?: string) => post<{ condition: BackendCondition; eligibility: { eligible: boolean; reason: string | null } }>(`/api/conditions/${conditionId}/review`, { decision, feedback })
export const satisfyEscrowCondition = (id: string, type: string) => post(`/api/escrows/${id}/conditions/${type}/satisfy`)
export const releaseConditionEscrow = (id: string) => post(`/api/escrows/${id}/release`)
export const fundConditionEscrow = (id: string) => post(`/api/escrows/${id}/fund`)
export const createEscrowDispute = (id: string, data: {
  title: string; category: DisputeCategory; description: string; requestedResolution: RequestedResolution
  milestoneId?: string | null
}) => post<BackendDispute>(`/api/escrows/${id}/disputes`, data)
export const getEscrowDisputes = (id: string) => get<BackendDispute[]>(`/api/escrows/${id}/disputes`)

async function requestMultipart<T>(path: string, formData: FormData): Promise<T> {
  let res: Response
  try {
    const headers = new Headers()
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
    formData.delete("actorId")
    res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers, body: formData })
  } catch {
    throw new ApiError("Unable to reach the SecureEscrow server. Make sure the backend is running.", "NETWORK_ERROR", 0)
  }
  let body: any = null
  try { body = await res.json() } catch { /* ignore non-JSON error responses */ }
  if (!res.ok || body?.success === false) {
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(body?.message || `Request failed with status ${res.status}`, body?.error || "UNKNOWN_ERROR", res.status, body?.details)
  }
  return (body?.data ?? body) as T
}

export const uploadDisputeEvidence = (disputeId: string, file: File, description = "") => {
  const formData = new FormData()
  formData.append("description", description)
  formData.append("file", file)
  return requestMultipart<BackendDisputeEvidence>(`/api/disputes/${encodeURIComponent(disputeId)}/evidence`, formData)
}
export const getDisputeEvidence = (disputeId: string) => get<BackendDisputeEvidence[]>(`/api/disputes/${encodeURIComponent(disputeId)}/evidence`)
export const getDisputeMessages = (disputeId: string) => get<BackendDisputeMessage[]>(`/api/disputes/${encodeURIComponent(disputeId)}/messages`)
export const sendDisputeMessage = (disputeId: string, message: string) => post<BackendDisputeMessage>(`/api/disputes/${encodeURIComponent(disputeId)}/messages`, { message })
export const resolveDispute = (disputeId: string, data: { decision: "RELEASE_TO_PROVIDER" | "REFUND_TO_CLIENT" | "SPLIT_FUNDS" | "PARTIAL_RELEASE"; reasoning: string; providerAmount?: number; clientAmount?: number; idempotencyKey: string }) => post<BackendDisputeResolution & { status: string; transactions: BackendTransaction[]; replayed?: boolean }>(`/api/disputes/${encodeURIComponent(disputeId)}/resolve`, data)
export const changeDisputeStatus = (disputeId: string, status: string, reason: string) => request<{ dispute: BackendDispute; history: BackendDisputeStatusHistory }>(`/api/disputes/${encodeURIComponent(disputeId)}/status`, { method: "PATCH", body: JSON.stringify({ status, reason }) })
export const getDisputeStatusHistory = (disputeId: string) => get<BackendDisputeStatusHistory[]>(`/api/disputes/${encodeURIComponent(disputeId)}/history`)
export const getDisputeResolutions = (disputeId: string) => get<BackendDisputeResolution[]>(`/api/disputes/${encodeURIComponent(disputeId)}/resolutions`)
// File URLs cannot carry Authorization headers. Consumers should fetch evidence through
// the authenticated client; this value is only retained for display compatibility.
export async function downloadDisputeEvidence(disputeId: string, evidenceId: string): Promise<Blob> {
  const headers = new Headers()
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
  let response: Response
  try { response = await fetch(`${API_BASE_URL}/api/disputes/${encodeURIComponent(disputeId)}/evidence/${encodeURIComponent(evidenceId)}/file`, { headers }) }
  catch { throw new ApiError("Unable to reach the SecureEscrow server. Make sure the backend is running.", "NETWORK_ERROR", 0) }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.()
    let message = `Request failed with status ${response.status}`
    try { message = (await response.json())?.message || message } catch { /* file response */ }
    throw new ApiError(message, "DOWNLOAD_FAILED", response.status)
  }
  return response.blob()
}

// ─── Milestones ─────────────────────────────────────────────────────────────
export const getMilestonesByEscrow = (escrowId: string) => get<BackendMilestone[]>(`/api/escrows/${escrowId}/milestones`)
export const getMilestone = (id: string) => get<BackendMilestone>(`/api/milestones/${id}`)
export const createMilestone = (escrowId: string, data: { title: string; description?: string; amount: number }) =>
  post<BackendMilestone>(`/api/escrows/${escrowId}/milestones`, data)

// ─── Milestone lifecycle actions ────────────────────────────────────────────
export const fundMilestone = (escrowId: string, milestoneId: string) => post<FundOrReleaseResult>(`/api/escrows/${escrowId}/fund`, { milestoneId })
export const startMilestone = (escrowId: string, milestoneId: string) => post<BackendMilestone>(`/api/escrows/${escrowId}/start`, { milestoneId })
export const submitMilestone = (milestoneId: string, attachments: { name: string; type: string; data: string }[]) => post<BackendMilestone>(`/api/milestones/${milestoneId}/submit`, { attachments })
export const reviewMilestone = (milestoneId: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/review`)
export const approveMilestone = (milestoneId: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/approve`)
export const rejectMilestone = (milestoneId: string, feedback: string) => post<BackendMilestone>(`/api/milestones/${milestoneId}/reject`, { feedback })
export const releaseMilestone = (milestoneId: string) => post<FundOrReleaseResult>(`/api/milestones/${milestoneId}/release`)

// ─── Transactions & Ledger ─────────────────────────────────────────────────
export const getTransaction = (id: string) => get<BackendTransaction>(`/api/transactions/${id}`)
export const getTransactionsByEscrow = (escrowId: string) => get<BackendTransaction[]>(`/api/transactions/escrow/${escrowId}`)
export const getTransactionLedger = (transactionId: string) => get<BackendLedgerEntry[]>(`/api/transactions/${transactionId}/ledger`)
export const validateLedger = () => get<LedgerValidationResult>("/api/transactions/validation/ledger")

// ─── Aggregate helpers ──────────────────────────────────────────────────────
export interface EscrowWithReleaseItems extends BackendEscrow { milestones?: BackendMilestone[]; conditions?: BackendCondition[]; disputes?: BackendDispute[]; releaseEligibility?: { eligible: boolean; reason: string | null; conditions: BackendCondition[] } }

export async function getAllEscrowsWithReleaseItems(adminView = false): Promise<EscrowWithReleaseItems[]> {
  const escrows = await getEscrows()
  return Promise.all(escrows.map(async escrow => ({
    ...escrow,
    disputes: await getEscrowDisputes(escrow.id),
    ...(!adminView && escrow.releaseModel === "MILESTONE_BASED" ? { milestones: await getMilestonesByEscrow(escrow.id) } : {}),
    ...(!adminView && escrow.releaseModel === "CONDITION_BASED" ? { conditions: await getConditions(escrow.id), releaseEligibility: await getReleaseEligibility(escrow.id) } : {}),
  })))
}

// Retained for existing consumers; the app uses release-model-aware loading above.
export async function getAllEscrowsWithMilestones(): Promise<(BackendEscrow & { milestones: BackendMilestone[] })[]> {
  const escrows = await getAllEscrowsWithReleaseItems()
  return escrows.map(escrow => ({ ...escrow, milestones: escrow.milestones ?? [] }))
}

export async function getAllTransactionsForEscrows(escrowIds: string[]): Promise<BackendTransaction[]> {
  const lists = await Promise.all(escrowIds.map(id => getTransactionsByEscrow(id)))
  return lists.flat().sort((a, b) => a.createdAt - b.createdAt)
}

export async function getAllLedgerEntriesForTransactions(transactionIds: string[]): Promise<BackendLedgerEntry[]> {
  const lists = await Promise.all(transactionIds.map(id => getTransactionLedger(id)))
  return lists.flat()
}
