import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import * as api from "./services/api"
import type {
  BackendUser, BackendAccount, BackendTransaction, BackendLedgerEntry, MilestoneStatus,
  BackendDispute, BackendDisputeEvidence, BackendDisputeMessage, DisputeCategory, RequestedResolution,
} from "./services/api"
import { useAuth } from "./auth/AuthContext"

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = "dashboard" | "disputes" | "escrow" | "transactions" | "ledger" | "accounts"
type Role = "CLIENT" | "PROVIDER" | "ADMIN"
// EscrowState mirrors the backend's milestone status values (the backend's
// escrow-level `status` field is never transitioned by any route — only
// milestones move through this lifecycle — so the frontend derives a
// display "escrow state" from its milestones; see deriveEscrowState()).
type EscrowState = MilestoneStatus
type ReleaseModel = "Milestone Based" | "Condition Based"

interface Milestone {
  id: string
  title: string
  amount: number
  description: string
  state: EscrowState
  order: number
  submissions?: NonNullable<api.BackendMilestone["submissions"]>
  reviewFeedback?: string | null
}

interface Escrow {
  id: string
  title: string
  description: string
  domain: string
  providerName: string
  providerId: string
  clientId: string
  totalAmount: number
  releaseModel: ReleaseModel
  state: EscrowState
  milestones?: Milestone[]
  conditions: api.BackendCondition[]
  disputes: BackendDispute[]
  releaseEligible: boolean
  releaseBlockedReason: string | null
  disputed: boolean
  createdAt: string
}

interface Transaction {
  id: string
  type: "FUND" | "RELEASE" | "REFUND" | "DEPOSIT" | "WITHDRAWAL"
  escrowId: string | null
  escrowTitle: string
  milestoneId: string
  amount: number
  from: string
  to: string
  fromAccountId: string
  toAccountId: string
  status: "COMPLETED" | "PENDING" | "FAILED"
  timestamp: string
}

interface LedgerEntry {
  txId: string
  txType: "FUND" | "RELEASE" | "REFUND" | "DEPOSIT" | "WITHDRAWAL"
  account: string
  entryType: "DEBIT" | "CREDIT"
  amount: number
  balance: number
}

interface Toast {
  id: string
  type: "success" | "error" | "info"
  title: string
  message?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_ORDER: EscrowState[] = [
  "CREATED", "FUNDED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "RELEASED",
]

const LIFECYCLE = [
  { state: "CREATED" as EscrowState, label: "Created", desc: "Escrow agreement created" },
  { state: "FUNDED" as EscrowState, label: "Funded", desc: "Funds deposited into escrow" },
  { state: "IN_PROGRESS" as EscrowState, label: "In Progress", desc: "Provider is working on the milestone" },
  { state: "SUBMITTED" as EscrowState, label: "Submitted", desc: "Work submitted for review" },
  { state: "UNDER_REVIEW" as EscrowState, label: "Under Review", desc: "Client reviewing the submission" },
  { state: "APPROVED" as EscrowState, label: "Approved", desc: "Client approved the milestone" },
  { state: "RELEASED" as EscrowState, label: "Released", desc: "Payment released to provider" },
]


// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`
const stateIdx = (s: EscrowState) => Math.max(0, STATE_ORDER.indexOf(s))
const genId = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const fmtTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19)
// Real IDs from the backend are UUIDs; show a short human-readable form in
// dense UI while all API requests still use the full UUID (escrow.id / m.id).
const shortId = (id: string | null) => id ? id.slice(0, 8).toUpperCase() : "—"

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/** The backend never transitions an escrow's own `status` field — only its
 * milestones move through the lifecycle. This derives a single display
 * state for an escrow from its milestones: the state of the earliest
 * (lowest `order`) milestone that hasn't been released yet, or RELEASED
 * once every milestone has been released. */
function deriveEscrowState(milestones: Milestone[]): EscrowState {
  if (milestones.length === 0) return "CREATED"
  const sorted = [...milestones].sort((a, b) => a.order - b.order)
  const terminal = ["RELEASED", "CANCELLED", "RESOLVED"]
  const active = sorted.find(m => !terminal.includes(m.state))
  if (active) return active.state
  if (milestones.every(m => m.state === "RELEASED")) return "RELEASED"
  if (milestones.every(m => m.state === "CANCELLED")) return "CANCELLED"
  return "RESOLVED"
}

function extractApiErrorMessage(err: unknown): string {
  if (err instanceof api.ApiError) return err.message
  if (err instanceof Error) return err.message
  return "Something went wrong."
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ShieldIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
}
function GridIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg> }
function LockIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> }
function ArrowsIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg> }
function BookIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg> }
function UsersIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> }
function PlusIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg> }
function ArrowLeftIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg> }
function CheckIcon({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> }
function XIcon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg> }
function ChevronRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg> }
function LogOutIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg> }
function SpinnerIcon() { return <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg> }
function ArrowRightIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg> }

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ state }: { state: string }) {
  const map: Record<string, string> = {
    IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
    COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    RELEASED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FUNDED: "bg-violet-50 text-violet-700 border-violet-200",
    CREATED: "bg-slate-100 text-slate-600 border-slate-200",
    SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
    UNDER_REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
    FAILED: "bg-red-50 text-red-700 border-red-200",
    DEBIT: "bg-red-50 text-red-700 border-red-200",
    CREDIT: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FUND: "bg-violet-50 text-violet-700 border-violet-200",
    RELEASE: "bg-blue-50 text-blue-700 border-blue-200",
    DEPOSIT: "bg-emerald-50 text-emerald-700 border-emerald-200",
    WITHDRAWAL: "bg-amber-50 text-amber-700 border-amber-200",
    CLIENT: "bg-blue-50 text-blue-700 border-blue-200",
    PROVIDER: "bg-violet-50 text-violet-700 border-violet-200",
    ADMIN: "bg-amber-50 text-amber-700 border-amber-200",
  }
  const cls = map[state] ?? "bg-slate-100 text-slate-600 border-slate-200"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono border tracking-wide ${cls}`}>
      {state.replace(/_/g, " ")}
    </span>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

function Btn({ children, onClick, variant = "primary", disabled = false, loading = false, size = "md", className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "outline"
  disabled?: boolean; loading?: boolean; size?: "sm" | "md" | "lg"; className?: string
}) {
  const base = "inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 cursor-pointer"
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-400",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-400 bg-white",
  }
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${disabled || loading ? "opacity-50 cursor-not-allowed" : ""} ${className}`}>
      {loading && <SpinnerIcon />}
      {children}
    </button>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, children, wide = false }: { open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full z-10 overflow-hidden ${wide ? "max-w-2xl" : "max-w-md"}`}>
        {children}
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm pointer-events-auto min-w-72 max-w-80 bg-white ${
          t.type === "success" ? "border-emerald-200" : t.type === "error" ? "border-red-200" : "border-blue-200"}`}>
          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
            t.type === "success" ? "bg-emerald-100 text-emerald-600" : t.type === "error" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
            {t.type === "success" ? <CheckIcon size={10} /> : t.type === "error" ? <XIcon size={10} /> : <span className="text-xs font-bold leading-none">i</span>}
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-900 text-sm">{t.title}</p>
            {t.message && <p className="text-slate-500 text-xs mt-0.5">{t.message}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5"><XIcon size={14} /></button>
        </div>
      ))}
    </div>
  )
}

// ─── Account Selection Page ───────────────────────────────────────────────────

function LoginPage({ onLogin, onRegister, loading, error }: {
  onLogin: (email: string, password: string) => void; onRegister: (data: { username: string; email: string; password: string; role: "CLIENT" | "PROVIDER" }) => Promise<void>; loading: boolean; error: string | null
}) {
  const [registerMode, setRegisterMode] = useState(false)
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [role, setRole] = useState<"CLIENT" | "PROVIDER">("CLIENT")
  const [notice, setNotice] = useState("")
  const [localError, setLocalError] = useState("")
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white"><ShieldIcon size={20} /></div>
        <div><p className="text-slate-900 font-bold text-lg leading-tight">SecureEscrow</p><p className="text-slate-400 text-xs">Secure transactions. Conditional release. Complete trust.</p></div>
      </div>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 text-center"><h1 className="text-2xl font-bold text-slate-900">{registerMode ? "Create your account" : "Sign in"}</h1><p className="mt-1 text-sm text-slate-500">SecureEscrow account access.</p></div>
        {(error || localError) && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</p>}{notice && <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p>}
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); setLocalError(""); if (registerMode) { if (password !== confirm) { setLocalError("Passwords do not match."); return } void onRegister({ username, email, password, role }).then(() => { setRegisterMode(false); setNotice("Account created. Sign in to continue."); setPassword(""); setConfirm("") }).catch(e => setLocalError(extractApiErrorMessage(e))) } else onLogin(email, password) }}>
          {registerMode && <label className="block text-sm font-medium text-slate-700">Username<input required minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]+" autoComplete="username" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal" value={username} onChange={event => setUsername(event.target.value)} /></label>}
          <label className="block text-sm font-medium text-slate-700">Email<input required type="email" autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" value={email} onChange={event => setEmail(event.target.value)} /></label>
          {registerMode && <label className="block text-sm font-medium text-slate-700">Account type<select value={role} onChange={event => setRole(event.target.value as "CLIENT" | "PROVIDER")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5"><option value="CLIENT">Client</option><option value="PROVIDER">Provider</option></select></label>}
          <label className="block text-sm font-medium text-slate-700">Password<input autoComplete="current-password" type="password" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" value={password} onChange={event => setPassword(event.target.value)} /></label>
          {registerMode && <label className="block text-sm font-medium text-slate-700">Confirm password<input required type="password" value={confirm} onChange={event => setConfirm(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5" /></label>}
          <Btn className="w-full justify-center" loading={loading} disabled={!email.trim() || !password || (registerMode && !username.trim())}>{registerMode ? "Create Account" : "Sign In"} <ArrowRightIcon /></Btn>
        </form>
        <button className="mt-5 text-sm text-blue-700" onClick={() => { setRegisterMode(!registerMode); setLocalError(""); setNotice("") }}>{registerMode ? "Already registered? Sign in" : "New to SecureEscrow? Create an account"}</button>
      </div>
    </div>
  )
}
// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV = [
  { id: "dashboard", label: "Overview", icon: GridIcon },
  { id: "disputes", label: "Dispute Management", icon: BookIcon },
  { id: "escrow", label: "Escrows", icon: LockIcon },
  { id: "transactions", label: "Transactions", icon: ArrowsIcon },
  { id: "accounts", label: "Accounts", icon: UsersIcon },
  { id: "ledger", label: "Ledger", icon: BookIcon },
] as const

function Sidebar({ page, setPage, role, user, onSwitch }: {
  page: Page; setPage: (p: Page) => void; role: Role; user: BackendUser; onSwitch: () => void
}) {
  const initials = user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
  const navItems = role === "ADMIN" ? NAV.filter(item => item.id !== "accounts") : NAV.filter(item => item.id !== "disputes")
  return (
    <aside className="w-60 bg-slate-900 flex flex-col flex-shrink-0 h-screen sticky top-0">
      <div className="px-5 py-6 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
            <ShieldIcon size={16} />
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">SecureEscrow</p>
            <p className="text-slate-500 text-xs">Transaction Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = page === id
          return (
            <button key={id} onClick={() => setPage(id as Page)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 text-left ${
                active ? "bg-blue-600 text-white font-medium" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}>
              <Icon />{role === "ADMIN" && id === "dashboard" ? "Admin Dashboard" : label}
            </button>
          )
        })}
      </nav>

      {/* Profile */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="px-3 py-3.5 rounded-xl bg-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${role === "CLIENT" ? "bg-blue-600" : role === "PROVIDER" ? "bg-violet-600" : "bg-amber-600"}`}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-slate-200 text-sm font-semibold truncate">{user.name}</p>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold font-mono tracking-wider border ${
                role === "CLIENT" ? "bg-blue-900/60 text-blue-300 border-blue-700" : role === "PROVIDER" ? "bg-violet-900/60 text-violet-300 border-violet-700" : "bg-amber-900/60 text-amber-300 border-amber-700"}`}>
                {role}
              </span>
            </div>
          </div>
          <button onClick={onSwitch}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-xs font-medium transition-all">
            <LogOutIcon /> Sign Out
          </button>
        </div>
      </div>
    </aside>
  )
}

// ─── Escrow Card ──────────────────────────────────────────────────────────────

function EscrowCard({ escrow, role, clientName, onClick }: { escrow: Escrow; role: Role; clientName: string; onClick: () => void }) {
  const idx = stateIdx(escrow.state)
  const progress = Math.round((idx / (STATE_ORDER.length - 1)) * 100)

  return (
    <div onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer group">
      <div className="p-5 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{escrow.title}</h3>
            <Badge state={escrow.state} />
          </div>
          <p className="text-xs text-slate-400">{escrow.domain} · {shortId(escrow.id)}</p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-xl font-bold font-mono text-slate-900">{fmt(escrow.totalAmount)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{escrow.releaseModel === "Milestone Based" ? `${escrow.milestones?.length ?? 0} milestone${escrow.milestones?.length !== 1 ? "s" : ""}` : `${escrow.conditions.length} condition${escrow.conditions.length !== 1 ? "s" : ""}`}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        {role === "ADMIN" ? <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
          {[["Client", clientName], ["Provider", escrow.providerName], ["Release Model", escrow.releaseModel]].map(([label, value]) => <div key={label}>
            <p className="text-slate-400 uppercase tracking-wide font-medium mb-1">{label}</p><p className="text-slate-700 font-medium">{value}</p>
          </div>)}
        </div> : <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
          <div><p className="text-slate-400 uppercase tracking-wide font-medium mb-1">{role === "CLIENT" ? "Provider" : "Client"}</p><p className="text-slate-700 font-medium">{role === "CLIENT" ? escrow.providerName : clientName}</p></div>
          <div><p className="text-slate-400 uppercase tracking-wide font-medium mb-1">Release Model</p><p className="text-slate-700 font-medium">{escrow.releaseModel}</p></div>
        </div>}
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-400">Lifecycle progress</span>
            <span className="font-mono font-medium text-slate-600">{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
        <p className="text-xs text-slate-400">{escrow.createdAt.slice(0, 10)}</p>
        <span className="text-xs text-blue-600 font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
          View Escrow <ChevronRightIcon />
        </span>
      </div>
    </div>
  )
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

function DashboardPage({ escrows, transactions, role, user, clientName, clientBalance, providerBalance, setPage, setSelectedEscrowId, onCreateEscrow }: {
  escrows: Escrow[]; transactions: Transaction[]; role: Role; user: BackendUser; clientName: string
  clientBalance: number; providerBalance: number
  setPage: (p: Page) => void; setSelectedEscrowId: (id: string) => void; onCreateEscrow: () => void
}) {
  const activeEscrows = escrows.filter(e => e.state !== "RELEASED")
  const totalEscrowed = activeEscrows.reduce((s, e) => s + e.totalAmount, 0)
  const totalReleased = transactions.filter(t => t.type === "RELEASE" && t.status === "COMPLETED").reduce((s, t) => s + t.amount, 0)
  const pendingReview = escrows.flatMap(e => e.milestones ?? []).filter(m => m.state === "SUBMITTED").length

  const clientCards = [
    { label: "Available Balance", value: fmt(clientBalance), sub: "Client account" },
    { label: "Active Escrows", value: String(activeEscrows.length), sub: "In progress" },
    { label: "Total Escrowed", value: fmt(totalEscrowed), sub: "Held in escrow" },
    { label: "Released", value: fmt(totalReleased), sub: "Payments completed" },
  ]
  const providerCards = [
    { label: "Available Balance", value: fmt(providerBalance), sub: "Received to date" },
    { label: "Active Work", value: String(escrows.flatMap(e => e.milestones ?? []).filter(m => m.state === "IN_PROGRESS").length), sub: "Milestones in progress" },
    { label: "Pending Review", value: String(pendingReview), sub: "Awaiting client review" },
    { label: "Released", value: fmt(totalReleased), sub: "Total earnings" },
  ]

  const cards = role === "CLIENT" ? clientCards : providerCards
  const sectionLabel = role === "CLIENT" ? "My Escrows" : "Assigned Escrows"
  const emptyLabel = role === "CLIENT" ? "No escrow agreements yet." : "No escrows assigned."

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{greeting()}, {user.name}</h1>
            <p className="text-slate-500 text-sm mt-1">
              {role === "CLIENT"
                ? "Manage your escrow agreements and release payments securely."
                : "Track your active work, milestones, and payments."}
            </p>
          </div>
          {role === "CLIENT" && <Btn onClick={onCreateEscrow}><PlusIcon /> Create Escrow</Btn>}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {cards.map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">{c.label}</p>
              <p className="text-2xl font-bold text-slate-900 font-mono">{c.value}</p>
              <p className="text-xs text-slate-400 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Escrows */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{sectionLabel}</h2>
            {escrows.length > 2 && (
              <button onClick={() => setPage("escrow")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View all →</button>
            )}
          </div>
          {escrows.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="font-medium text-slate-700">{emptyLabel}</p>
              {role === "CLIENT" && (
                <><p className="text-slate-400 text-sm mt-1 mb-4">Create your first escrow to get started.</p>
                  <Btn onClick={onCreateEscrow} size="sm"><PlusIcon size={14} /> Create Escrow</Btn></>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {escrows.slice(0, 4).map(e => (
                <EscrowCard key={e.id} escrow={e} role={role} clientName={clientName} onClick={() => setSelectedEscrowId(e.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-4">Recent Transactions</h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {transactions.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">No transactions yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {transactions.slice(-4).reverse().map(tx => (
                    <div key={tx.id} className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Badge state={tx.type} />
                        <div>
                          <p className="text-sm font-medium text-slate-800">{tx.from} → {tx.to}</p>
                          <p className="text-xs text-slate-400 font-mono">{tx.id}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold font-mono text-slate-900">{fmt(tx.amount)}</p>
                        <Badge state={tx.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-5 py-3 border-t border-slate-100">
                <button onClick={() => setPage("transactions")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View all →</button>
              </div>
            </div>
          </div>

          <div>
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
      Recent Ledger
    </h2>
    <button
      onClick={() => setPage("ledger")}
      className="text-xs font-medium text-blue-600 hover:text-blue-700"
    >
      View All
    </button>
  </div>

  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
    {transactions.length === 0 ? (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-400">
          No ledger transactions yet.
        </p>
      </div>
    ) : (
      <div className="divide-y divide-slate-100">
        {transactions.slice(0, 4).map(tx => (
          <div
            key={tx.id}
            className="px-4 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                  tx.type === "FUND"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                {tx.type === "FUND" || tx.type === "DEPOSIT" ? "↓" : "↑"}
              </div>

              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  {tx.type === "DEPOSIT" ? "Funds Added to Account" : tx.type === "WITHDRAWAL" ? "Funds Withdrawn" : tx.type === "FUND" ? "Funds Added to Escrow" : "Payment Released"}
                </p>

                <p className="text-[11px] text-slate-400 font-mono truncate">
                  {shortId(tx.id)} · {tx.timestamp}
                </p>
              </div>
            </div>

            <div className="text-right ml-3">
              <p className="text-sm font-semibold font-mono text-slate-800">
                {fmt(tx.amount)}
              </p>
              <p className="text-[10px] text-emerald-600 font-medium">
                {tx.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
        </div>
      </div>
    </div>
  )
}

function AdminDashboardPage({ escrows, transactions, users, onViewEscrows, onViewDisputes, onViewTransactions, onOpenEscrow }: {
  escrows: Escrow[]; transactions: Transaction[]; users: BackendUser[]
  onViewEscrows: () => void; onViewDisputes: () => void; onViewTransactions: () => void; onOpenEscrow: (id: string) => void
}) {
  const activeCount = escrows.filter(escrow => escrow.state !== "RELEASED").length
  const disputedCount = escrows.filter(escrow => escrow.disputed).length
  const releasedAmount = transactions.filter(transaction => transaction.type === "RELEASE" && transaction.status === "COMPLETED").reduce((sum, transaction) => sum + transaction.amount, 0)
  const cards = [
    { label: "Total Escrows", value: String(escrows.length), detail: "Agreements on platform" },
    { label: "Active Escrows", value: String(activeCount), detail: "Not yet released" },
    { label: "Disputed", value: String(disputedCount), detail: "Require attention" },
    { label: "Released", value: fmt(releasedAmount), detail: `${transactions.length} transactions` },
  ]
  return <div className="flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl px-8 py-8">
    <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Platform Administration</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Admin Dashboard</h1><p className="mt-1 text-sm text-slate-500">Escrow overview and dispute review.</p></div>
    <div className="mb-8 grid grid-cols-4 gap-4">{cards.map(card => <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">{card.label}</p><p className="font-mono text-2xl font-bold text-slate-900">{card.value}</p><p className="mt-1 text-xs text-slate-400">{card.detail}</p></div>)}</div>
    <div className="mb-8 flex items-center justify-between"><div><h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Recent Escrows</h2><p className="mt-1 text-xs text-slate-500">{users.length} demo users · {transactions.length} recorded transactions</p></div><button onClick={onViewEscrows} className="text-xs font-medium text-blue-600 hover:text-blue-700">View all escrows →</button></div>
    {escrows.length ? <div className="grid grid-cols-2 gap-4">{[...escrows].slice(-4).reverse().map(escrow => <EscrowCard key={escrow.id} escrow={escrow} role="ADMIN" clientName={users.find(user => user.id === escrow.clientId)?.name ?? "Client"} onClick={() => onOpenEscrow(escrow.id)} />)}</div> : <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No escrow agreements have been created.</div>}
    <div className="mt-8 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-5"><div><h2 className="font-semibold text-slate-800">Dispute management</h2><p className="mt-1 text-sm text-slate-600">{disputedCount} active dispute{disputedCount === 1 ? "" : "s"} need review.</p></div><Btn onClick={onViewDisputes}>Open Disputes</Btn></div>
    <div className="mt-6 flex justify-end"><button onClick={onViewTransactions} className="text-xs font-medium text-blue-600 hover:text-blue-700">Review platform transactions →</button></div>
  </div></div>
}

export function AdminDisputeManagement({ escrows, transactions, actorId, onRefresh, onOpenEscrow }: {
  escrows: Escrow[]; transactions: Transaction[]; actorId: string; onRefresh: () => Promise<void>
  onOpenEscrow: (escrowId: string) => void
}) {
  const disputes = escrows.flatMap(escrow => escrow.disputes.map(dispute => ({ escrow, dispute })))
  const [selectedId, setSelectedId] = useState("")
  const [decision, setDecision] = useState<"RELEASE_TO_PROVIDER" | "REFUND_TO_CLIENT" | "SPLIT_FUNDS" | "PARTIAL_RELEASE">("RELEASE_TO_PROVIDER")
  const [providerAmount, setProviderAmount] = useState("")
  const [clientAmount, setClientAmount] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [evidenceRequest, setEvidenceRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [audit, setAudit] = useState<api.BackendDisputeStatusHistory[]>([])
  const [resolutions, setResolutions] = useState<api.BackendDisputeResolution[]>([])
  const [auditRefresh, setAuditRefresh] = useState(0)
  const pendingResolutions = useRef(new Map<string, string>())
  const selected = disputes.find(item => item.dispute.id === selectedId) ?? disputes.find(item => item.dispute.status !== "RESOLVED")
  useEffect(() => {
    if (!selected) { setAudit([]); setResolutions([]); return }
    let active = true
    Promise.all([api.getDisputeStatusHistory(selected.dispute.id), api.getDisputeResolutions(selected.dispute.id)])
      .then(([history, records]) => { if (active) { setAudit(history); setResolutions(records) } })
      .catch(() => { if (active) { setAudit([]); setResolutions([]) } })
    return () => { active = false }
  }, [selected?.dispute.id, selected?.dispute.status, actorId, auditRefresh])
  const effectiveScope = selected?.dispute.milestoneId ?? null
  const available = selected ? transactions.filter(tx => tx.escrowId === selected.escrow.id && tx.status === "COMPLETED" && (!effectiveScope || tx.milestoneId === effectiveScope)).reduce((sum, tx) => sum + (tx.type === "FUND" ? tx.amount : ["RELEASE", "REFUND"].includes(tx.type) ? -tx.amount : 0), 0) : 0
  const providerValue = Number(providerAmount) || 0
  const clientValue = Number(clientAmount) || 0
  const allocationsValid = decision === "SPLIT_FUNDS" ? providerValue > 0 && clientValue > 0 && Math.round((providerValue + clientValue) * 1e8) === Math.round(available * 1e8)
    : decision === "PARTIAL_RELEASE" ? providerValue > 0 && providerValue < available : available > 0
  const resolutionDisabledReason = !reasoning.trim() ? "Enter the admin reasoning to continue."
    : available <= 0 ? "This escrow has no completed funds available to resolve. Confirm it has been funded, then refresh the dispute data."
      : decision === "SPLIT_FUNDS" && !(providerValue > 0 && clientValue > 0) ? "Enter positive amounts for both the provider release and client refund."
        : decision === "SPLIT_FUNDS" && Math.round((providerValue + clientValue) * 1e8) !== Math.round(available * 1e8) ? "The provider release and client refund must add up to the available escrow funds."
          : decision === "PARTIAL_RELEASE" && !(providerValue > 0 && providerValue < available) ? "Enter a provider release greater than zero and less than the available funds." : ""
  const nextTransition = selected?.dispute.status === "OPEN" ? "UNDER_REVIEW" : selected?.dispute.status === "EVIDENCE_SUBMISSION" ? "UNDER_REVIEW" : selected?.dispute.status === "UNDER_REVIEW" ? "EVIDENCE_SUBMISSION" : null
  const execute = async () => {
    if (!selected || !reasoning.trim()) { setError("Add the resolution reasoning first."); return }
    const provider = decision === "SPLIT_FUNDS" ? Number(providerAmount) : decision === "PARTIAL_RELEASE" ? Number(providerAmount) : undefined
    const client = decision === "SPLIT_FUNDS" ? Number(clientAmount) : undefined
    const parts = decision === "SPLIT_FUNDS" ? `Client refund ${fmt(client!)} and Provider release ${fmt(provider!)}`
      : decision === "PARTIAL_RELEASE" ? `Provider release ${fmt(provider!)}; ${fmt(available - provider!)} remains frozen`
        : decision === "RELEASE_TO_PROVIDER" ? `Provider receives ${fmt(available)}` : `Client receives ${fmt(available)}`
    const summary = `${selected.dispute.title}\nDecision: ${decision.replaceAll("_", " ")}\n${parts}\nReason: ${reasoning.trim()}`
    if (!window.confirm(`Confirm dispute resolution?\n\n${summary}`)) return
    const intent = JSON.stringify([selected.dispute.id, decision, reasoning.trim(), provider, client])
    const key = pendingResolutions.current.get(intent) ?? crypto.randomUUID()
    pendingResolutions.current.set(intent, key)
    setBusy(true); setError(""); setNotice("")
    try {
      await api.resolveDispute(selected.dispute.id, { decision, reasoning: reasoning.trim(), ...(provider !== undefined ? { providerAmount: provider } : {}), ...(client !== undefined ? { clientAmount: client } : {}), idempotencyKey: key })
      pendingResolutions.current.delete(intent)
      setNotice("Resolution executed successfully."); setReasoning(""); setProviderAmount(""); setClientAmount(""); await onRefresh(); setAuditRefresh(value => value + 1)
    } catch (err) {
      if (err instanceof api.ApiError && err.status > 0 && err.status < 500) pendingResolutions.current.delete(intent)
      setError(extractApiErrorMessage(err))
    }
    finally { setBusy(false) }
  }
  const moveStatus = async () => {
    if (!selected || !nextTransition) return
    const reason = nextTransition === "EVIDENCE_SUBMISSION" ? evidenceRequest.trim() : "Admin began dispute review"
    if (!reason) { setError("Describe the specific evidence needed from the participants."); return }
    setBusy(true); setError(""); setNotice("")
    try { await api.changeDisputeStatus(selected.dispute.id, nextTransition, reason); setNotice(nextTransition === "EVIDENCE_SUBMISSION" ? "Evidence request sent to both participants." : "Dispute moved to Admin review."); setEvidenceRequest(""); await onRefresh(); setAuditRefresh(value => value + 1) }
    catch (err) { setError(extractApiErrorMessage(err)) }
    finally { setBusy(false) }
  }
  return <main className="flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl px-8 py-8"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Platform Administration</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Dispute Management</h1><p className="mt-1 text-sm text-slate-500">Review evidence and messages, request specific evidence, and record an outcome.</p></div><section className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="mb-4"><h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">Disputes</h2><p className="mt-1 text-xs text-slate-500">Review cases and allocate only their associated Client and Provider escrow funds.</p></div>
    {disputes.length === 0 ? <p className="text-sm text-slate-400">There are no disputes to review.</p> : <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_2fr]">
      <div className="space-y-2">{disputes.map(({ escrow, dispute }) => <button key={dispute.id} onClick={() => setSelectedId(dispute.id)} className={`w-full rounded-lg border p-3 text-left ${selected?.dispute.id === dispute.id ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}><span className="block text-sm font-medium text-slate-800">{dispute.title}</span><span className="mt-1 block text-xs text-slate-500">{escrow.title} · {dispute.status.replaceAll("_", " ")}</span></button>)}</div>
      {selected && <div className="space-y-3 rounded-lg border border-slate-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-800">{selected.dispute.title}</h3><p className="text-xs text-slate-500">{selected.escrow.title} · {selected.dispute.category.replaceAll("_", " ")}</p></div><Badge state={selected.dispute.status} /></div>
        <p className="text-sm text-slate-600 whitespace-pre-wrap">{selected.dispute.reason}</p>
        <p className="text-xs text-slate-500">Available for selected scope: <strong>{fmt(available)}</strong> · Requested: {selected.dispute.requestedResolution.replaceAll("_", " ")}</p>
        <p className="text-xs text-slate-500">Dispute scope: {selected.dispute.milestoneId ? selected.escrow.milestones?.find(item => item.id === selected.dispute.milestoneId)?.title ?? "Related milestone" : "Whole escrow"}</p>
        <button onClick={() => onOpenEscrow(selected.escrow.id)} className="text-xs font-medium text-blue-600 hover:text-blue-700">Open evidence and conversation</button>
        <details className="rounded-md bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">Audit trail · {audit.length} events</summary><div className="mt-2 space-y-2">{audit.map(event => <div key={event.id} className="border-l-2 border-slate-300 pl-2"><p className="text-xs text-slate-700">{event.eventType.replaceAll("_", " ")} · {event.fromStatus ?? "Created"} → {event.toStatus}</p><p className="text-xs text-slate-500">{event.reason} · {new Date(event.createdAt).toLocaleString()}</p></div>)}{resolutions.map(record => <div key={record.id} className="border-l-2 border-emerald-300 pl-2"><p className="text-xs text-slate-700">{record.decision.replaceAll("_", " ")} · {record.executionStatus}</p><p className="text-xs text-slate-500">{record.reasoning} · {new Date(record.createdAt).toLocaleString()}</p></div>)}</div></details>
        {nextTransition === "EVIDENCE_SUBMISSION" && <label className="block text-xs font-medium text-slate-600">Evidence requested from Client and Provider<textarea rows={3} maxLength={2000} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={evidenceRequest} onChange={event => setEvidenceRequest(event.target.value)} placeholder="Describe exactly what evidence is needed, such as a dated delivery receipt or screenshots of the completed service." /></label>}
        {nextTransition && <button disabled={busy || (nextTransition === "EVIDENCE_SUBMISSION" && !evidenceRequest.trim())} onClick={moveStatus} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50">{nextTransition === "UNDER_REVIEW" ? "Begin Admin Review" : "Send Evidence Request"}</button>}
        {selected.dispute.status !== "RESOLVED" && <div className="space-y-3 border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-600">Decision<select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={decision} onChange={event => setDecision(event.target.value as typeof decision)}>{["RELEASE_TO_PROVIDER", "REFUND_TO_CLIENT", "SPLIT_FUNDS", "PARTIAL_RELEASE"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
          {(decision === "SPLIT_FUNDS" || decision === "PARTIAL_RELEASE") && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Provider release amount<input type="number" min="0.01" step="0.01" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={providerAmount} onChange={event => setProviderAmount(event.target.value)} /></label>{decision === "SPLIT_FUNDS" && <label className="text-xs font-medium text-slate-600">Client refund amount<input type="number" min="0.01" step="0.01" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={clientAmount} onChange={event => setClientAmount(event.target.value)} /></label>}</div>}
          <label className="block text-xs font-medium text-slate-600">Reasoning<textarea rows={3} maxLength={4000} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={reasoning} onChange={event => setReasoning(event.target.value)} /></label>
          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">Execution summary: {decision === "SPLIT_FUNDS" ? `Client refund ${fmt(clientValue)} + Provider release ${fmt(providerValue)} = ${fmt(clientValue + providerValue)} (available: ${fmt(available)})` : decision === "PARTIAL_RELEASE" ? `Provider release ${fmt(providerValue)}; ${fmt(Math.max(0, available - providerValue))} remains in the disputed escrow` : `${decision === "RELEASE_TO_PROVIDER" ? "Provider receives" : "Client receives"} ${fmt(available)}`}</p>
          {resolutionDisabledReason && <p role="status" className="text-xs text-amber-700">{resolutionDisabledReason}</p>}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}{notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
          <div className="flex justify-end"><Btn loading={busy} disabled={!reasoning.trim() || !allocationsValid || busy} onClick={execute}>Review and Confirm Resolution</Btn></div>
        </div>}
        {selected.dispute.status === "RESOLVED" && <p className="text-sm text-emerald-700">This dispute has been resolved.</p>}
      </div>}
    </div>}
  </section></div></main>
}

// ─── Escrow List Page ─────────────────────────────────────────────────────────

function EscrowListPage({ escrows, role, clientName, setSelectedEscrowId, onCreateEscrow }: {
  escrows: Escrow[]; role: Role; clientName: string; setSelectedEscrowId: (id: string) => void; onCreateEscrow: () => void
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Escrows</h1>
            <p className="text-slate-500 text-sm mt-1">{escrows.length} agreement{escrows.length !== 1 ? "s" : ""} total.</p>
          </div>
          {role === "CLIENT" && <Btn onClick={onCreateEscrow}><PlusIcon /> Create Escrow</Btn>}
        </div>
        {escrows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="font-medium text-slate-700">No escrow agreements</p>
            {role === "CLIENT" && <><p className="text-slate-400 text-sm mt-1 mb-4">Create your first escrow to get started.</p>
              <Btn onClick={onCreateEscrow} size="sm"><PlusIcon size={14} /> Create Escrow</Btn></>}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {escrows.map(e => (
              <EscrowCard key={e.id} escrow={e} role={role} clientName={clientName} onClick={() => setSelectedEscrowId(e.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Lifecycle Timeline ───────────────────────────────────────────────────────

function LifecycleTimeline({ current }: { current: EscrowState }) {
  const currentIdx = stateIdx(current)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-6">Lifecycle</h3>
      <div className="relative">
        <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-200" />
        <div className="absolute left-4 top-4 w-px bg-blue-500 transition-all duration-500"
          style={{ height: `${Math.max(0, (currentIdx / (STATE_ORDER.length - 1)) * 100)}%` }} />
        <div className="space-y-0">
          {LIFECYCLE.map(({ state, label, desc }, i) => {
            const done = i < currentIdx, active = i === currentIdx
            return (
              <div key={state} className={`flex gap-5 ${i < LIFECYCLE.length - 1 ? "pb-5" : ""}`}>
                <div className="relative z-10 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    done ? "bg-blue-600 border-blue-600 text-white" :
                    active ? "bg-white border-blue-600 text-blue-600 ring-4 ring-blue-100" :
                    "bg-white border-slate-300 text-slate-400"}`}>
                    {done ? <CheckIcon size={12} /> : active ? <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" /> : <div className="w-2 h-2 bg-slate-300 rounded-full" />}
                  </div>
                </div>
                <div className="pt-1">
                  <p className={`text-sm font-semibold ${active ? "text-blue-700" : done ? "text-slate-700" : "text-slate-400"}`}>{label}</p>
                  <p className={`text-xs mt-0.5 ${active ? "text-blue-500" : "text-slate-400"}`}>{desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Milestone Card ───────────────────────────────────────────────────────────

function MilestoneCard({ milestone, role, onAction, loadingAction }: {
  milestone: Milestone; role: Role
  onAction: (action: string, milestoneId: string, payload?: { attachments?: { name: string; type: string; data: string }[]; feedback?: string }) => void | Promise<void>; loadingAction: string | null
}) {
  const [files, setFiles] = useState<File[]>([])
  const [feedback, setFeedback] = useState("")
  const [submissionError, setSubmissionError] = useState("")
  const totalFileSize = files.reduce((total, file) => total + file.size, 0)
  const filesAreValid = files.length > 0 && files.length <= 5 && files.every(file => file.size <= 5 * 1024 * 1024) && totalFileSize <= 7 * 1024 * 1024
  const idx = stateIdx(milestone.state)
  const progress = Math.round((idx / (STATE_ORDER.length - 1)) * 100)
  const milestoneClosed = ["RELEASED", "CANCELLED", "RESOLVED"].includes(milestone.state)

  // CLIENT actions
  const clientActions: Partial<Record<EscrowState, { label: string; action: string; variant: "primary" | "secondary" | "danger" }>> = {
    CREATED: { label: "Fund Escrow", action: "FUND", variant: "primary" },
    SUBMITTED: { label: "Begin Review", action: "REVIEW", variant: "secondary" },
    UNDER_REVIEW: { label: "Approve Milestone", action: "APPROVE", variant: "primary" },
    APPROVED: { label: "Release Payment", action: "RELEASE", variant: "primary" },
  }
  // PROVIDER actions
  const providerActions: Partial<Record<EscrowState, { label: string; action: string; variant: "primary" | "secondary" }>> = {
    FUNDED: { label: "Start Work", action: "START", variant: "primary" },
    IN_PROGRESS: { label: "Submit for Review", action: "SUBMIT", variant: "primary" },
  }

  const actionMap: Partial<Record<EscrowState, { label: string; action: string; variant: "primary" | "secondary" | "danger" }>> = role === "CLIENT" ? clientActions : role === "PROVIDER" ? providerActions : {}
  const currentAction = actionMap[milestone.state]
  const isLoading = loadingAction === `${milestone.id}-${currentAction?.action}`

  const waitingMessage: Partial<Record<EscrowState, string>> = role === "CLIENT" ? {
    FUNDED: "Waiting for provider to start work.",
    IN_PROGRESS: "Provider is working — waiting for submission.",
    RELEASED: "Payment has been released.",
    CANCELLED: "Funds were refunded for this milestone.",
    RESOLVED: "This milestone was closed by dispute resolution.",
  } : {
    CREATED: "Waiting for client to fund this milestone.",
    SUBMITTED: "Waiting for client to begin review.",
    UNDER_REVIEW: "Client is reviewing — waiting for approval.",
    APPROVED: "Approved — awaiting payment release by client.",
    RELEASED: "Payment received.",
    CANCELLED: "This milestone was refunded.",
    RESOLVED: "This milestone was closed by dispute resolution.",
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400 font-mono font-medium mb-0.5">{shortId(milestone.id)}</p>
          <h3 className="text-base font-semibold text-slate-900">{milestone.title}</h3>
          {milestone.description && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-500">{milestone.description}</p>}
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-xl font-bold font-mono text-slate-900">{fmt(milestone.amount)}</p>
          <div className="mt-1"><Badge state={milestone.state} /></div>
        </div>
      </div>
      <div className="px-6 py-5">
        <div className="mb-5">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-slate-500">Completion</span>
            <span className="font-mono font-medium text-slate-700">{progress}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${milestoneClosed ? 100 : progress}%`, background: milestoneClosed ? "#10B981" : "#2563EB" }} />
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg px-4 py-3 mb-5 text-xs">
          <p className="text-slate-400 mb-1">Current state</p>
          <Badge state={milestone.state} />
          <p className="text-slate-500 mt-2">{LIFECYCLE.find(l => l.state === milestone.state)?.desc ?? (milestoneClosed ? "Closed milestone" : "")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {currentAction?.action === "SUBMIT" && (
            <div className="w-full space-y-2">
              <p className="text-xs font-medium text-slate-700">Submit your work files</p>
              <label className="flex min-h-24 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/60 px-4 py-4 text-center transition-colors hover:border-blue-500 hover:bg-blue-50 focus-within:ring-2 focus-within:ring-blue-500">
                <span className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">Choose files</span>
                <span className="mt-2 text-xs text-slate-500">Select up to 5 files · 5 MB each · 7 MB total</span>
                <input aria-label="Choose work files to submit" className="sr-only" type="file" multiple onChange={e => { setFiles(Array.from(e.target.files ?? [])); setSubmissionError("") }} />
              </label>
              {files.length > 0 && <ul className="space-y-1 text-xs text-slate-600">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><span className="shrink-0">{(file.size / (1024 * 1024)).toFixed(2)} MB</span></li>)}</ul>}
          {files.length > 0 && !filesAreValid && <p className="text-xs text-red-600">Choose up to 5 files, no larger than 5 MB each or 7 MB combined.</p>}
          {submissionError && <p role="alert" className="text-xs text-red-600">{submissionError}</p>}
            </div>
          )}
          {milestone.reviewFeedback && ["IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW"].includes(milestone.state) && <p className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Revision requested: {milestone.reviewFeedback}</p>}
          {milestone.submissions?.length ? <div className="w-full space-y-2">
            <p className="text-xs font-medium text-slate-500">Provider submissions</p>
            {milestone.submissions.map((submission, index) => <div key={`${submission.submittedAt}-${index}`} className="rounded-lg border border-slate-100 p-3">
              <p className="mb-2 text-xs text-slate-400">Submission {index + 1} · {new Date(submission.submittedAt).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2">{submission.attachments.map((file, fileIndex) => <a key={`${file.name}-${fileIndex}`} href={file.data} download={file.name} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-700 underline">{file.name}</a>)}</div>
            </div>)}
          </div> : null}
          {milestone.state === "UNDER_REVIEW" && role === "CLIENT" && <label className="w-full text-xs text-slate-600">Feedback for provider if revisions are needed
            <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Explain what should be changed" />
          </label>}
          {currentAction ? (
            <Btn variant={currentAction.variant as "primary" | "secondary"} loading={isLoading}
              disabled={currentAction.action === "SUBMIT" && !filesAreValid}
              onClick={async () => {
                if (currentAction.action !== "SUBMIT") return await onAction(currentAction.action, milestone.id)
                setSubmissionError("")
                try {
                  const attachments = await Promise.all(files.map(file => new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", data: String(reader.result) })
                    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
                    reader.readAsDataURL(file)
                  })))
                  await onAction(currentAction.action, milestone.id, { attachments })
                  setFiles([])
                } catch (err) { setSubmissionError(extractApiErrorMessage(err)) }
              }}>
              {currentAction.label}
            </Btn>
          ) : milestone.state === "UNDER_REVIEW" && role === "CLIENT" ? null : (
            <p className="text-xs text-slate-400 italic">
              {role === "ADMIN" ? "Read-only administrator view." : waitingMessage[milestone.state] ?? "No action available in this state."}
            </p>
          )}
          {milestone.state === "UNDER_REVIEW" && role === "CLIENT" && <Btn variant="danger" size="sm" disabled={!feedback.trim()} loading={loadingAction === `${milestone.id}-REJECT`} onClick={() => onAction("REJECT", milestone.id, { feedback })}>Request Revision</Btn>}
        </div>
      </div>
    </div>
  )
}

// ─── Escrow Details Page ──────────────────────────────────────────────────────

const CONDITION_OPTIONS = ["CLIENT_APPROVAL", "WORK_SUBMITTED", "PARTICIPANT_APPROVAL", "EVIDENCE_SUBMITTED", "DEADLINE_REACHED", "DELIVERY_CONFIRMED", "EXTERNAL_VERIFICATION", "CUSTOM"]
type ConditionDraft = { title: string; description: string; type: string; required: boolean; config: Record<string, unknown>; draftId?: string }
const toLocalDateTime = (value: string) => {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function ConditionForm({ initial, onSave, onCancel, saving }: {
  initial?: ConditionDraft; onSave: (draft: ConditionDraft) => void; onCancel: () => void; saving: boolean
}) {
  const [draft, setDraft] = useState<ConditionDraft>(initial ?? { title: "", description: "", type: "PARTICIPANT_APPROVAL", required: true, config: { actorRole: "PAYER" } })
  const set = (key: keyof ConditionDraft, value: string | boolean) => setDraft(current => ({ ...current, [key]: value }))
  const configValue = (key: string) => String(draft.config[key] ?? "")
  const setConfig = (key: string, value: unknown) => setDraft(current => ({ ...current, config: { ...current.config, [key]: value } }))
  const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
  return <div className="grid grid-cols-2 gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
    <label className="text-xs text-slate-600">Title<input className={`${inputCls} mt-1`} value={draft.title} onChange={e => set("title", e.target.value)} /></label>
    <label className="text-xs text-slate-600">Condition type<select className={`${inputCls} mt-1`} value={draft.type} onChange={e => { set("type", e.target.value); if (e.target.value === "DEADLINE_REACHED") setConfig("deadline", "") }}>
      {CONDITION_OPTIONS.map(type => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
    </select></label>
    <label className="col-span-2 text-xs text-slate-600">Description<textarea className={`${inputCls} mt-1`} rows={2} value={draft.description} onChange={e => set("description", e.target.value)} /></label>
    {draft.type === "DEADLINE_REACHED" && <label className="col-span-2 text-xs text-slate-600">Deadline<input className={`${inputCls} mt-1`} type="datetime-local" value={configValue("deadline").slice(0, 16)} onChange={e => setConfig("deadline", e.target.value)} /></label>}
    {draft.type === "EXTERNAL_VERIFICATION" && <><label className="text-xs text-slate-600">Verification source<input className={`${inputCls} mt-1`} value={configValue("verificationSource")} onChange={e => setConfig("verificationSource", e.target.value)} placeholder="Provider or integration name" /></label><label className="text-xs text-slate-600">Verifier participant role<input className={`${inputCls} mt-1`} value={configValue("verifierRole")} onChange={e => setConfig("verifierRole", e.target.value)} placeholder="VERIFIER" /></label></>}
    {(["PARTICIPANT_APPROVAL", "CUSTOM"].includes(draft.type)) && <label className="text-xs text-slate-600">Authorized participant role<input className={`${inputCls} mt-1`} value={configValue("actorRole")} onChange={e => setConfig("actorRole", e.target.value)} placeholder="PAYER or PAYEE" /></label>}
    {draft.type === "EVIDENCE_SUBMITTED" && <label className="text-xs text-slate-600">Evidence requirement<input className={`${inputCls} mt-1`} value={configValue("evidenceRequirement")} onChange={e => setConfig("evidenceRequirement", e.target.value)} placeholder="Describe required evidence" /></label>}
    <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={draft.required} onChange={e => set("required", e.target.checked)} />Required for release</label>
    <div className="col-span-2 flex justify-end gap-2"><Btn size="sm" variant="secondary" onClick={onCancel}>Cancel</Btn><Btn size="sm" loading={saving} disabled={!draft.title.trim() || !draft.description.trim() || (draft.type === "DEADLINE_REACHED" && !configValue("deadline")) || (draft.type === "EXTERNAL_VERIFICATION" && (!configValue("verificationSource") || !configValue("verifierRole"))) || (draft.type === "EVIDENCE_SUBMITTED" && !configValue("evidenceRequirement")) || (["PARTICIPANT_APPROVAL", "CUSTOM"].includes(draft.type) && !configValue("actorRole"))} onClick={() => onSave(draft)}>Save Condition</Btn></div>
  </div>
}

export function ConditionManagement({ conditions, canEdit, canRespond, role, onCreate, onUpdate, onDelete, onSatisfy, onReviewWork, busy }: {
  conditions: api.BackendCondition[]; canEdit: boolean; canRespond: boolean; role: Role
  onCreate: (draft: ConditionDraft) => void; onUpdate: (id: string, draft: ConditionDraft) => void
  onDelete: (id: string) => void; onSatisfy: (id: string, evidence?: string) => void
  onReviewWork: (id: string, decision: "APPROVE" | "REJECT", feedback?: string) => void; busy: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({})
  const inputFor = (condition: api.BackendCondition): ConditionDraft => ({ ...condition, config: {
    ...condition.config,
    ...(condition.config.deadline ? { deadline: toLocalDateTime(String(condition.config.deadline)) } : {}),
  } })
  const saveDraft = (draft: ConditionDraft, id?: string) => {
    const config = { ...draft.config }
    if (draft.type === "DEADLINE_REACHED" && config.deadline) config.deadline = new Date(String(config.deadline)).toISOString()
    const cleanDraft = { ...draft, config }
    if (id) { onUpdate(id, cleanDraft); setEditing(null) }
    else { onCreate(cleanDraft); setCreating(false) }
  }
  const canSatisfy = (condition: api.BackendCondition) => {
    const defaultRole = { CLIENT_APPROVAL: "PAYER", DELIVERY_CONFIRMED: "PAYER", WORK_SUBMITTED: "PAYEE", EVIDENCE_SUBMITTED: "PAYEE" }[condition.type]
    const actorRole = String(condition.type === "EXTERNAL_VERIFICATION" ? condition.config.verifierRole ?? "" : condition.config.actorRole ?? defaultRole ?? "")
    if (["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type)) return role === "PROVIDER" && ["PENDING", "REJECTED"].includes(condition.status)
    return actorRole === "PAYER" ? role === "CLIENT" : actorRole === "PAYEE" ? role === "PROVIDER" : false
  }
  return <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Release Conditions · {conditions.filter(c => c.required).length} required</h3>{canEdit && <Btn size="sm" variant="outline" onClick={() => { setEditing(null); setCreating(true) }}>Add Condition</Btn>}</div>
    {conditions.map(condition => <div key={condition.id} className="rounded-lg border border-slate-100 p-3 space-y-2">
      {editing === condition.id ? <ConditionForm initial={inputFor(condition)} saving={busy} onCancel={() => setEditing(null)} onSave={draft => saveDraft(draft, condition.id)} /> : <>
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-800">{condition.title} {!condition.required && <span className="text-xs text-slate-400">(optional)</span>}</p><p className="text-xs text-slate-500 mt-0.5">{condition.description}</p><p className="text-xs text-slate-400 mt-1">{condition.type.replaceAll("_", " ")}{condition.config.deadline ? ` · ${new Date(String(condition.config.deadline)).toLocaleString()}` : ""}</p></div>
          <span className={`text-xs font-medium ${condition.status === "SATISFIED" ? "text-emerald-700" : condition.status === "FAILED" ? "text-red-700" : "text-amber-700"}`}>{condition.status}</span></div>
        {condition.status === "PENDING" && <p className="text-xs text-amber-700">{["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type) ? "Waiting for the provider to submit the required work or evidence." : condition.type === "DEADLINE_REACHED" ? `Pending until ${new Date(String(condition.config.deadline)).toLocaleString()}` : condition.type === "EXTERNAL_VERIFICATION" ? `Awaiting verification from ${String(condition.config.verificationSource)}` : "Waiting for the authorized participant to complete this condition."}</p>}
        {condition.status === "SUBMITTED" && <p className="text-xs text-blue-700">Provider submitted {condition.type === "WORK_SUBMITTED" ? "work" : "evidence"}{condition.verificationDetails?.evidence ? `: ${String(condition.verificationDetails.evidence)}` : ""}. Waiting for creator review.</p>}
        {condition.status === "REJECTED" && <p className="text-xs text-red-700">Submission needs revision{condition.verificationDetails?.reviewFeedback ? `: ${String(condition.verificationDetails.reviewFeedback)}` : ""}. The provider can submit it again.</p>}
        {condition.status === "SATISFIED" && <p className="text-xs text-slate-400">Satisfied {condition.satisfiedAt ? `at ${new Date(condition.satisfiedAt).toLocaleString()}` : ""}{condition.satisfiedBy ? ` by ${condition.satisfiedBy}` : ""}{condition.verificationDetails?.evidence ? ` · ${String(condition.verificationDetails.evidence)}` : ""}</p>}
        <div className="flex flex-wrap gap-2">{canEdit && <><Btn size="sm" variant="outline" onClick={() => setEditing(condition.id)}>Edit</Btn><Btn size="sm" variant="outline" onClick={() => onDelete(condition.id)}>Remove</Btn></>}
          {!canEdit && canRespond && canSatisfy(condition) && <><input className="border border-slate-200 rounded-lg px-2 py-1 text-xs" placeholder={condition.type === "WORK_SUBMITTED" ? "Work link or submission evidence (required)" : condition.type === "EVIDENCE_SUBMITTED" ? "Required evidence link or details" : "Evidence (if requested)"} value={evidence[condition.id] ?? ""} onChange={e => setEvidence(current => ({ ...current, [condition.id]: e.target.value }))} /><Btn size="sm" disabled={["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type) && !evidence[condition.id]?.trim()} onClick={() => onSatisfy(condition.id, evidence[condition.id])}>{["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type) ? (condition.status === "REJECTED" ? "Resubmit" : "Submit Evidence") : condition.type === "CLIENT_APPROVAL" ? "Approve" : "Complete Condition"}</Btn></>}
          {!canEdit && canRespond && ["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type) && condition.status === "SUBMITTED" && role === "CLIENT" && <><input className="border border-slate-200 rounded-lg px-2 py-1 text-xs" placeholder="Feedback (required if rejecting)" value={reviewFeedback[condition.id] ?? ""} onChange={e => setReviewFeedback(current => ({ ...current, [condition.id]: e.target.value }))} /><Btn size="sm" variant="outline" onClick={() => onReviewWork(condition.id, "APPROVE", reviewFeedback[condition.id])}>Accept Submission</Btn><Btn size="sm" variant="outline" disabled={!reviewFeedback[condition.id]?.trim()} onClick={() => onReviewWork(condition.id, "REJECT", reviewFeedback[condition.id])}>Reject Submission</Btn></>}
          {!canRespond && role === "PROVIDER" && ["WORK_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(condition.type) && ["PENDING", "REJECTED"].includes(condition.status) && <p className="text-xs text-slate-500">Submission is available after the client successfully funds the escrow.</p>}
        </div>
      </>}
    </div>)}
    {creating && <ConditionForm saving={busy} onCancel={() => setCreating(false)} onSave={draft => saveDraft(draft)} />}
    {conditions.length === 0 && <p className="text-sm text-red-600">At least one condition is required before funding.</p>}
  </div>
}

export function DisputeEvidencePanel({ dispute, role, actorId, users }: {
  dispute: BackendDispute; role: Role; actorId: string; users: BackendUser[]
}) {
  const [evidence, setEvidence] = useState<BackendDisputeEvidence[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const downloadEvidence = async (item: BackendDisputeEvidence) => {
    try {
      const blob = await api.downloadDisputeEvidence(dispute.id, item.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url; link.download = item.fileName
      link.click(); URL.revokeObjectURL(url)
    } catch (err) { setError(extractApiErrorMessage(err)) }
  }
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    api.getDisputeEvidence(dispute.id)
      .then(items => { if (active) setEvidence(items) })
      .catch(err => { if (active) setError(extractApiErrorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [dispute.id, actorId])

  const submit = async () => {
    if (!file) { setError("Choose a PDF, JPG, or PNG file."); return }
    if (file.size === 0) { setError("The selected file is empty."); return }
    if (file.size > 5 * 1024 * 1024) { setError("Evidence files must be 5 MB or smaller."); return }
    setUploading(true)
    setError("")
    setSuccess("")
    try {
      const created = await api.uploadDisputeEvidence(dispute.id, file, description)
      setEvidence(items => [...items, created].sort((a, b) => a.createdAt - b.createdAt))
      setFile(null)
      setDescription("")
      if (fileInput.current) fileInput.current.value = ""
      setSuccess("Evidence uploaded successfully.")
    } catch (err) { setError(extractApiErrorMessage(err)) }
    finally { setUploading(false) }
  }

  const displayName = (id: string) => users.find(user => user.id === id)?.name ?? id
  return <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3 space-y-3">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Evidence · {evidence.length}</h4>
    {loading ? <p className="text-xs text-slate-400">Loading evidence…</p> : evidence.length === 0 ? <p className="text-xs text-slate-400">No evidence submitted yet.</p> : <div className="space-y-2">
      {evidence.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{item.fileName}</p>
          <p className="text-xs text-slate-500">{item.mimeType} · {(item.fileSize / 1024).toFixed(1)} KB · {displayName(item.uploadedBy)} · {new Date(item.createdAt).toLocaleString()}</p>
          {item.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.description}</p>}
        </div>
        <button className="text-xs font-medium text-blue-600 hover:text-blue-700" onClick={() => void downloadEvidence(item)}>Open / Download</button>
      </div>)}
    </div>}
    {dispute.status !== "RESOLVED" && role !== "ADMIN" && <div className="space-y-2 border-t border-slate-200 pt-3">
      <label className="block text-xs font-medium text-slate-600">Attach evidence (PDF, JPG, or PNG; up to 5 MB)
        <input ref={fileInput} className="mt-1 block w-full text-xs text-slate-600" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={uploading} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); setSuccess("") }} />
      </label>
      {file && <p className="text-xs text-slate-500">Selected: {file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
      <label className="block text-xs font-medium text-slate-600">Description (optional)
        <textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} maxLength={2000} value={description} disabled={uploading} onChange={event => setDescription(event.target.value)} />
      </label>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {success && <p role="status" className="text-xs text-emerald-700">{success}</p>}
      <div className="flex justify-end"><Btn size="sm" loading={uploading} disabled={!file} onClick={submit}>Upload Evidence</Btn></div>
    </div>}
    {error && (dispute.status !== "OPEN" || role === "ADMIN") && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>
}

export function DisputeActivityPanel({ dispute, actorId }: { dispute: BackendDispute; actorId: string }) {
  const [history, setHistory] = useState<api.BackendDisputeStatusHistory[]>([])
  const [resolutions, setResolutions] = useState<api.BackendDisputeResolution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const refresh = useCallback(async () => {
    try {
      const [events, records] = await Promise.all([api.getDisputeStatusHistory(dispute.id), api.getDisputeResolutions(dispute.id)])
      setHistory(events); setResolutions(records); setError("")
    } catch (err) { setError(extractApiErrorMessage(err)) }
    finally { setLoading(false) }
  }, [dispute.id, actorId])
  useEffect(() => {
    setLoading(true); void refresh()
    if (dispute.status === "RESOLVED") return
    const timer = window.setInterval(() => { void refresh() }, 6000)
    return () => window.clearInterval(timer)
  }, [refresh, dispute.status])
  return <section className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3" aria-label="Dispute updates">
    <div className="flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Admin updates and outcome</h4><button type="button" className="text-xs text-blue-600" onClick={() => { setLoading(true); void refresh() }}>Refresh</button></div>
    {loading ? <p className="mt-2 text-xs text-slate-400">Loading dispute updates…</p> : history.length === 0 && resolutions.length === 0 ? <p className="mt-2 text-xs text-slate-500">No admin updates yet.</p> : <div className="mt-2 space-y-2">
      {history.map(event => <article key={event.id} className="rounded-md bg-white p-3"><p className="text-xs font-semibold text-slate-700">{event.fromStatus === null ? "Dispute opened" : event.eventType === "RESOLUTION_FAILED" ? "Resolution attempt" : event.changedBy === dispute.raisedBy ? "Participant update" : "Admin update"} · {event.toStatus.replaceAll("_", " ")}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{event.reason}</p><time className="mt-1 block text-xs text-slate-400">{new Date(event.createdAt).toLocaleString()}</time></article>)}
      {resolutions.map(record => <article key={record.id} className="rounded-md border border-emerald-100 bg-white p-3"><p className="text-xs font-semibold text-emerald-800">{record.decision.replaceAll("_", " ")} · {record.executionStatus}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{record.reasoning}</p>{record.allocations.map((allocation, index) => { const recipient = record.decision === "SPLIT_FUNDS" ? (index === 0 ? "Provider release" : "Client refund") : record.decision === "REFUND_TO_CLIENT" ? "Client refund" : "Provider release"; return <p key={allocation.id} className="mt-1 text-xs text-slate-600">{recipient}: {fmt(allocation.amount)} {allocation.currency}</p> })}{record.remainingEscrowBalance > 0 && <p className="mt-1 text-xs text-amber-700">Remaining in escrow: {fmt(record.remainingEscrowBalance)}</p>}<time className="mt-1 block text-xs text-slate-400">{new Date(record.createdAt).toLocaleString()}</time></article>)}
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">Could not load dispute updates: {error}</p>}
  </section>
}

export function DisputeConversation({ dispute, actorId }: {
  dispute: BackendDispute; actorId: string
}) {
  const [messages, setMessages] = useState<BackendDisputeMessage[]>([])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const refresh = useCallback(async () => {
    setError("")
    try { setMessages(await api.getDisputeMessages(dispute.id)) }
    catch (err) { setError(extractApiErrorMessage(err)) }
    finally { setLoading(false) }
  }, [dispute.id, actorId])
  useEffect(() => { setLoading(true); void refresh() }, [refresh])
  const send = async () => {
    if (!draft.trim()) { setError("Enter a message before sending."); return }
    setSending(true); setError(""); setNotice("")
    try {
      await api.sendDisputeMessage(dispute.id, draft)
      setDraft(""); await refresh(); setNotice("Message sent.")
    } catch (err) { setError(extractApiErrorMessage(err)) }
    finally { setSending(false) }
  }
  return <section className="space-y-3 border-t border-slate-100 pt-3" aria-label="Dispute conversation">
    <div className="flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Conversation · {messages.length}</h4><button className="text-xs text-blue-600" onClick={() => { setLoading(true); void refresh() }}>Refresh</button></div>
    {loading ? <p className="text-xs text-slate-400">Loading messages…</p> : messages.length === 0 ? <p className="text-xs text-slate-400">No messages yet.</p> : <div className="max-h-64 space-y-2 overflow-y-auto">
      {messages.map(item => <article key={item.id} className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex justify-between gap-2"><span className="text-xs font-semibold text-slate-700">{item.sender?.name ?? item.senderId} · {item.sender?.type === "CLIENT" ? "Client" : item.sender?.type === "PROVIDER" ? "Provider" : item.sender?.type === "ADMIN" ? "Admin" : "Participant"}</span><time className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</time></div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{item.message}</p>
      </article>)}
    </div>}
    {dispute.status !== "RESOLVED" && <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-600">Message<textarea className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={3} maxLength={5000} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message to the other participants" /></label>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}{notice && <p role="status" className="text-xs text-green-700">{notice}</p>}
      <div className="flex justify-end"><Btn size="sm" loading={sending} disabled={!draft.trim() || sending} onClick={send}>Send Message</Btn></div>
    </div>}
    {dispute.status !== "OPEN" && <p className="text-xs text-slate-400">Messaging is closed for this dispute.</p>}
    {loading && error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </section>
}

export function EscrowDetailsPage({ escrow, role, clientName, currentUserId, users, onAction, onConditionAction, onConditionCreate, onConditionUpdate, onConditionDelete, onConditionSatisfy, onConditionReviewWork, onDisputeCreate, loadingAction, onBack }: {
  escrow: Escrow; role: Role; clientName: string
  currentUserId: string; users: BackendUser[]
  onAction: (action: string, milestoneId: string) => void
  onConditionAction: (action: string) => void
  onConditionCreate: (draft: ConditionDraft) => void
  onConditionUpdate: (id: string, draft: ConditionDraft) => void
  onConditionDelete: (id: string) => void
  onConditionSatisfy: (id: string, evidence?: string) => void
  onConditionReviewWork: (id: string, decision: "APPROVE" | "REJECT", feedback?: string) => void
  onDisputeCreate: (input: { title: string; category: DisputeCategory; description: string; requestedResolution: RequestedResolution; milestoneId?: string }) => Promise<void>
  loadingAction: string | null; onBack: () => void
}) {
  const [disputeFormOpen, setDisputeFormOpen] = useState(false)
  const [disputeTitle, setDisputeTitle] = useState("")
  const [disputeCategory, setDisputeCategory] = useState<DisputeCategory>("OTHER")
  const [disputeDescription, setDisputeDescription] = useState("")
  const [requestedResolution, setRequestedResolution] = useState<RequestedResolution>("OTHER")
  const [disputeMilestoneId, setDisputeMilestoneId] = useState("")
  const [disputeError, setDisputeError] = useState("")
  const disputeBusy = loadingAction === "dispute-create"
  const hasOpenDispute = escrow.disputes.some(dispute => dispute.status !== "RESOLVED")
  const submitDispute = async () => {
    if (!disputeTitle.trim() || !disputeDescription.trim()) return
    setDisputeError("")
    try {
      await onDisputeCreate({ title: disputeTitle.trim(), category: disputeCategory, description: disputeDescription.trim(), requestedResolution, ...(disputeMilestoneId ? { milestoneId: disputeMilestoneId } : {}) })
      setDisputeFormOpen(false)
      setDisputeTitle("")
      setDisputeDescription("")
      setDisputeMilestoneId("")
    } catch (error) { setDisputeError(extractApiErrorMessage(error)) }
  }
  const toggleDisputeForm = () => {
    if (!disputeFormOpen && !disputeMilestoneId && escrow.milestones?.length) setDisputeMilestoneId(escrow.milestones[0].id)
    setDisputeFormOpen(open => !open)
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-6">
          <ArrowLeftIcon /> Back to Escrows
        </button>

        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-900">{escrow.title}</h1>
              <Badge state={escrow.state} />
            </div>
            <p className="text-slate-500 text-sm">{escrow.domain} · {shortId(escrow.id)} · {escrow.releaseModel}</p>
            {escrow.description && <p className="text-slate-400 text-sm mt-1">{escrow.description}</p>}
          </div>
          <div className="text-right flex-shrink-0 ml-6">
            <p className="text-3xl font-bold font-mono text-slate-900">{fmt(escrow.totalAmount)}</p>
            <p className="text-xs text-slate-400 mt-1">Total escrow value</p>
          </div>
        </div>

        {/* Participants */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[
            { roleLabel: "Client / Payer", name: clientName, id: escrow.clientId, note: "Approves and releases funds", badge: "CLIENT", isMe: role === "CLIENT" },
            { roleLabel: "Provider / Payee", name: escrow.providerName, id: escrow.providerId, note: "Delivers work, receives payment", badge: "PROVIDER", isMe: role === "PROVIDER" },
          ].map(p => (
            <div key={p.roleLabel} className={`bg-white rounded-xl border px-5 py-4 flex items-center gap-4 ${p.isMe ? "border-blue-200 bg-blue-50/30" : "border-slate-200"}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${p.badge === "CLIENT" ? "bg-blue-600" : "bg-violet-600"}`}>
                {p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{p.roleLabel}</p>
                  <Badge state={p.badge} />
                  {p.isMe && <span className="text-xs text-blue-600 font-medium">(you)</span>}
                </div>
                <p className="font-semibold text-slate-900 text-sm">{p.name}</p>
                <p className="text-xs text-slate-400 font-mono">{p.id} · {p.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Layout */}
        <div className="grid grid-cols-[260px_1fr] gap-6">
          <LifecycleTimeline current={escrow.state} />
          <div className="space-y-4">
            {escrow.disputed && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">This escrow is disputed. Funding and release actions are blocked while the Admin reviews the dispute.</div>}
            {escrow.disputes.length > 0 && <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Disputes</h3>
              {escrow.disputes.map(dispute => <div key={dispute.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3"><p className="font-medium text-slate-800">{dispute.title}</p><Badge state={dispute.status} /></div>
                <p className="text-xs text-slate-500 mt-1">{dispute.category.replaceAll("_", " ")} · {dispute.requestedResolution.replaceAll("_", " ")}</p>
                <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{dispute.reason}</p>
                <p className="text-xs text-slate-400 mt-2">Raised by {dispute.raisedBy} · {new Date(dispute.createdAt).toLocaleString()}</p>
                <DisputeActivityPanel dispute={dispute} actorId={currentUserId} />
                <DisputeConversation dispute={dispute} actorId={currentUserId} />
                <DisputeEvidencePanel dispute={dispute} role={role} actorId={currentUserId} users={users} />
              </div>)}
            </div>}
            {role !== "ADMIN" && !hasOpenDispute && <div className="flex justify-end"><Btn size="sm" variant="outline" onClick={toggleDisputeForm}>{disputeFormOpen ? "Cancel Dispute" : "Raise Dispute"}</Btn></div>}
            {disputeFormOpen && <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">Raise a dispute</h3>
              <label className="block text-xs font-medium text-slate-600">Title<input className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" maxLength={160} required value={disputeTitle} onChange={event => setDisputeTitle(event.target.value)} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-slate-600">Category<select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={disputeCategory} onChange={event => setDisputeCategory(event.target.value as DisputeCategory)}>{["NON_DELIVERY", "INCOMPLETE_DELIVERY", "QUALITY_ISSUE", "PAYMENT_ISSUE", "CONDITION_NOT_FULFILLED", "AGREEMENT_VIOLATION", "OTHER"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                <label className="text-xs font-medium text-slate-600">Requested resolution<select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={requestedResolution} onChange={event => setRequestedResolution(event.target.value as RequestedResolution)}>{["RELEASE_TO_PROVIDER", "REFUND_TO_CLIENT", "PARTIAL_RELEASE", "SPLIT_FUNDS", "OTHER"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
              </div>
              {escrow.releaseModel === "Milestone Based" && escrow.milestones && escrow.milestones.length > 0 && <label className="block text-xs font-medium text-slate-600">Related milestone (selected by default; choose Escrow level for a whole-agreement dispute)<select className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={disputeMilestoneId} onChange={event => setDisputeMilestoneId(event.target.value)}><option value="">Escrow level</option>{escrow.milestones.map(milestone => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</select></label>}
              <label className="block text-xs font-medium text-slate-600">Description<textarea className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" rows={4} required value={disputeDescription} onChange={event => setDisputeDescription(event.target.value)} /></label>
              {disputeError && <p role="alert" className="text-sm text-red-600">{disputeError}</p>}
              <div className="flex justify-end"><Btn loading={disputeBusy} disabled={!disputeTitle.trim() || !disputeDescription.trim()} onClick={submitDispute}>Submit Dispute</Btn></div>
            </div>}
            {/* Role context */}
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${
              role === "CLIENT" ? "bg-blue-50 border-blue-200 text-blue-700" : role === "PROVIDER" ? "bg-violet-50 border-violet-200 text-violet-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${role === "CLIENT" ? "bg-blue-500" : role === "PROVIDER" ? "bg-violet-500" : "bg-amber-500"}`} />
              {role === "CLIENT" ? "You are the client — you can fund, review, approve, and release payment."
                : role === "PROVIDER" ? "You are the provider — you can start work and submit for review."
                  : "Administrator view — agreement details are read-only."}
            </div>

            {!escrow.disputed && escrow.milestones?.map(m => (
              <MilestoneCard key={m.id} milestone={m} role={role} onAction={onAction} loadingAction={loadingAction} />
            ))}
            {escrow.releaseModel === "Condition Based" && <>
              <ConditionManagement conditions={escrow.conditions} canEdit={role === "CLIENT" && escrow.state === "CREATED" && !escrow.disputed} canRespond={escrow.state !== "CREATED" && !escrow.disputed && !["RELEASED", "CANCELLED", "EXPIRED"].includes(escrow.state)} role={role} onCreate={onConditionCreate} onUpdate={onConditionUpdate} onDelete={onConditionDelete} onSatisfy={onConditionSatisfy} onReviewWork={onConditionReviewWork} busy={Boolean(loadingAction)} />
              <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 space-y-3">
                <p className={`text-sm ${escrow.releaseEligible ? "text-emerald-700" : "text-amber-700"}`}>{escrow.releaseEligible ? "All required conditions are satisfied; release is eligible." : escrow.releaseBlockedReason}</p>
                <div className="flex flex-wrap gap-2">
                  {role === "CLIENT" && escrow.state === "CREATED" && <Btn size="sm" variant="outline" onClick={() => onConditionAction("FUND")}>Fund Escrow</Btn>}
                  {role === "CLIENT" && escrow.releaseEligible && <Btn size="sm" onClick={() => onConditionAction("RELEASE")}>Release Funds</Btn>}
                </div>
              </div>
            </>}

            {/* Meta */}
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Agreement Details</h3>
              <div className="grid grid-cols-2 gap-y-3 text-xs">
                {[["Escrow ID", shortId(escrow.id)], ["Domain", escrow.domain], ["Release Model", escrow.releaseModel],
                  ["Created", escrow.createdAt.slice(0, 10)], ["Provider", escrow.providerName], ["Provider ID", escrow.providerId]
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-slate-400">{k}</p>
                    <p className="text-slate-800 font-medium font-mono mt-0.5">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Transactions Page ────────────────────────────────────────────────────────

function TransactionsPage({ transactions, currentAccountId, onViewLedger }: {
  transactions: Transaction[]
  currentAccountId?: string
  onViewLedger: () => void
}) {
  const [selected, setSelected] = useState<Transaction | null>(null)

  // Show only transactions that involve the currently selected user's account.
  // The backend remains the source of truth; this is only a role/account view filter.
  const visibleTransactions = currentAccountId
    ? transactions.filter(tx => tx.fromAccountId === currentAccountId || tx.toAccountId === currentAccountId)
    : transactions

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
            <p className="text-slate-500 text-sm mt-1">Financial movements involving your account.</p>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-sm text-slate-600">
            <span className="font-mono font-medium">{visibleTransactions.length}</span> records
          </div>
        </div>
        <div className="grid grid-cols-[1fr_320px] gap-5">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {["Transaction", "Type", "Flow", "Amount", "Status"].map(h => (
                    <th key={h} className={`py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visibleTransactions.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400 text-sm">No transactions recorded yet.</td></tr>}
                {visibleTransactions.map(tx => (
                  <tr key={tx.id} onClick={() => setSelected(tx)}
                    className={`cursor-pointer hover:bg-slate-50 transition-colors ${selected?.id === tx.id ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-4"><p className="font-mono text-xs text-slate-400">{shortId(tx.id)}</p><p className="text-slate-600 text-xs mt-0.5 truncate max-w-32">{tx.escrowTitle}</p></td>
                    <td className="px-4 py-4"><Badge state={tx.type} /></td>
                    <td className="px-4 py-4 text-xs text-slate-600">{tx.from} → {tx.to}</td>
                    <td className="px-4 py-4 text-right font-mono font-semibold text-slate-900">{fmt(tx.amount)}</td>
                    <td className="px-4 py-4"><Badge state={tx.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            {selected ? (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-sm">Details</h3>
                  <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600"><XIcon size={14} /></button>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="flex justify-between"><Badge state={selected.type} /><Badge state={selected.status} /></div>
                  <div><p className="text-3xl font-bold font-mono text-slate-900">{fmt(selected.amount)}</p><p className="text-xs text-slate-400 mt-1">{selected.timestamp}</p></div>
                  <div className="space-y-3">
                    {[["Transaction ID", shortId(selected.id)], ["Source", selected.from], ["Destination", selected.to],
                      ["Escrow", shortId(selected.escrowId)], ["Milestone", shortId(selected.milestoneId)]].map(([k, v]) => (
                      <div key={k}><span className="text-xs text-slate-400 block">{k}</span><span className="font-mono text-xs text-slate-700 font-medium">{v}</span></div>
                    ))}
                  </div>
                  <Btn variant="outline" size="sm" className="w-full justify-center" onClick={onViewLedger}>View Ledger Entries</Btn>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                <p className="text-slate-400 text-sm">Select a transaction to view details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Ledger Page ──────────────────────────────────────────────────────────────

function LedgerPage({ entries, summary }: {
  entries: LedgerEntry[]
  summary: { totalDebits: number; totalCredits: number; balanced: boolean; transactionsValidated: number } | null
}) {
  const localDebits = entries.filter(e => e.entryType === "DEBIT").reduce((s, e) => s + e.amount, 0)
  const localCredits = entries.filter(e => e.entryType === "CREDIT").reduce((s, e) => s + e.amount, 0)
  // Prefer the backend's own GET /api/transactions/validation/ledger result
  // (the actual source of truth for whether the ledger is balanced); fall
  // back to a local recomputation from the fetched entries if unavailable.
  const totalDebits = summary?.totalDebits ?? localDebits
  const totalCredits = summary?.totalCredits ?? localCredits
  const balanced = summary?.balanced ?? (totalDebits === totalCredits)
  const transactionsValidated = summary?.transactionsValidated ?? Math.floor(entries.length / 2)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Double-Entry Ledger</h1>
          <p className="text-slate-500 text-sm mt-1">Every financial transaction is represented by balanced debit and credit entries.</p>
        </div>
        <div className={`rounded-xl border p-6 mb-8 ${balanced ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white ${balanced ? "bg-emerald-500" : "bg-red-500"}`}>
              {balanced ? <CheckIcon size={16} /> : <XIcon size={16} />}
            </div>
            <div>
              <p className={`font-bold text-base ${balanced ? "text-emerald-800" : "text-red-800"}`}>{balanced ? "Ledger Balanced" : "Imbalance Detected"}</p>
              <p className={`text-xs ${balanced ? "text-emerald-600" : "text-red-600"}`}>{balanced ? "All debit and credit entries are balanced." : "Debits and credits do not match."}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {[["Total Debits", fmt(totalDebits)], ["Total Credits", fmt(totalCredits)], ["Transactions Validated", String(transactionsValidated)]].map(([l, v]) => (
              <div key={l}>
                <p className={`text-xs font-medium uppercase tracking-wide ${balanced ? "text-emerald-600" : "text-red-600"}`}>{l}</p>
                <p className={`text-2xl font-bold font-mono mt-1 ${balanced ? "text-emerald-900" : "text-red-900"}`}>{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Transaction</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Account</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Entry</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-red-500 uppercase tracking-wider">Debit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-emerald-600 uppercase tracking-wider">Credit</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">No ledger entries yet.</td></tr>}
              {entries.map((e, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4"><Badge state={e.txType} /><p className="font-mono text-xs text-slate-400 mt-1">{shortId(e.txId)}</p></td>
                  <td className="px-4 py-4 text-xs text-slate-700 font-medium">{e.account}</td>
                  <td className="px-4 py-4"><Badge state={e.entryType} /></td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{e.entryType === "DEBIT" ? <span className="text-red-600 font-semibold">{fmt(e.amount)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm">{e.entryType === "CREDIT" ? <span className="text-emerald-600 font-semibold">{fmt(e.amount)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-4 text-right font-mono text-sm font-semibold text-slate-700">{fmt(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={3} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Totals</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{fmt(totalDebits)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">{fmt(totalCredits)}</td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Accounts Page ────────────────────────────────────────────────────────────

function AccountsPage({ currentAccountId, clientAccount, providerAccount, clientName, providerName, onTransfer }: {
  currentAccountId: string
  clientAccount: BackendAccount | null; providerAccount: BackendAccount | null
  clientName: string; providerName: string
  onTransfer: (operation: "DEPOSIT" | "WITHDRAWAL", amount: number) => Promise<boolean>
}) {
  const [amount, setAmount] = useState("")
  const [escrowHeld, setEscrowHeld] = useState<number | undefined>()
  const [holdingsError, setHoldingsError] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)
  const currentIsClient = currentAccountId === clientAccount?.id
  const currentAccount = currentIsClient ? clientAccount : providerAccount
  useEffect(() => {
    let mounted = true
    let pending = false
    const refreshHeld = async () => {
      if (pending) return
      pending = true
      try {
        const { balance } = await api.getEscrowHeld()
        if (mounted) {
          setEscrowHeld(balance)
          setHoldingsError(false)
        }
      } catch {
        if (mounted) setHoldingsError(true)
      } finally {
        pending = false
      }
    }
    void refreshHeld()
    const timer = window.setInterval(refreshHeld, 6000)
    window.addEventListener("focus", refreshHeld)
    return () => {
      mounted = false
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshHeld)
    }
  }, [])
  const transfer = async (operation: "DEPOSIT" | "WITHDRAWAL") => {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    setTransferLoading(true)
    try {
      if (await onTransfer(operation, parsedAmount)) setAmount("")
    } finally {
      setTransferLoading(false)
    }
  }

  const accounts = [
    currentIsClient
      ? { type: "CLIENT ACCOUNT", name: clientName, id: shortId(currentAccount?.id ?? ""), label: "Available Balance", balance: currentAccount?.balance ?? 0, color: "border-blue-200 bg-blue-50", dot: "bg-blue-500" }
      : { type: "PROVIDER ACCOUNT", name: providerName, id: shortId(currentAccount?.id ?? ""), label: "Available Balance", balance: currentAccount?.balance ?? 0, color: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500" },
    { type: "ESCROW ACCOUNT", name: "Held In Escrow", label: "Total Held", balance: holdingsError ? undefined : escrowHeld, color: "border-violet-200 bg-violet-50", dot: "bg-violet-500" },
  ]
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Accounts</h1>
          <p className="text-slate-500 text-sm mt-1">Your account balance and funds currently held in escrow.</p>
        </div>
        <div className="grid grid-cols-2 gap-5 mb-6">
          {accounts.map(a => (
            <div key={a.type} className={`rounded-xl border ${a.color}`}>
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center gap-2 mb-4"><div className={`w-2 h-2 rounded-full ${a.dot}`} /><p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{a.type}</p></div>
                <p className="font-semibold text-slate-800 mb-1">{a.name}</p>
                <p className="text-xs text-slate-400 font-mono mb-4">{a.id ?? "Your escrows"}</p>
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">{a.label}</p>
                <p className="text-2xl font-bold font-mono text-slate-900">{a.balance === undefined
                  ? (holdingsError ? "Unavailable" : "Loading…")
                  : `₹${a.balance.toLocaleString("en-IN", { maximumFractionDigits: 8 })}`}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-slate-800">Manage your account</h2>
          <p className="mt-1 text-xs text-slate-500">Add funds to your personal account or withdraw available funds. Amounts are in INR.</p>
          {/* <p className="mt-1 text-xs text-amber-700">Demo wallet only: these actions update the in-app ledger and do not move money through a bank or payment provider.</p> */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 text-xs font-medium text-slate-600">Amount
              <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Enter amount" />
            </label>
            <Btn loading={transferLoading} disabled={!amount || Number(amount) <= 0} onClick={() => transfer("DEPOSIT")}>Add Funds</Btn>
            <Btn variant="outline" loading={transferLoading} disabled={!amount || Number(amount) <= 0} onClick={() => transfer("WITHDRAWAL")}>Withdraw</Btn>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4 flex items-center justify-between">
          <div><p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Visible Account Value</p><p className="text-xs text-slate-400 mt-0.5">Personal account plus funds held in escrow</p></div>
          <p className="text-2xl font-bold font-mono text-slate-900">{escrowHeld === undefined || holdingsError ? "—" : fmt((currentAccount?.balance ?? 0) + escrowHeld)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Create Escrow Modal ──────────────────────────────────────────────────────

interface MilestoneForm { id: string; title: string; amount: string; description: string }

// Agreement setup supports the existing milestone path and the stored
// condition-based release configuration.
const amountScale = 100_000_000n
const maxEscrowUnits = 50_000_000n * amountScale

function escrowUnits(value: string): bigint | null {
  const decimal = value.trim()
  if (!/^(?:0*\d{1,8}(?:\.\d{0,8})?|\.\d{1,8})$/.test(decimal)) return null
  const [whole, fraction = ""] = decimal.split(".")
  const units = BigInt(whole || "0") * amountScale + BigInt(fraction.padEnd(8, "0"))
  return units > 0n && units <= maxEscrowUnits ? units : null
}

function escrowDecimal(units: bigint): string {
  const fraction = (units % amountScale).toString().padStart(8, "0").replace(/0+$/, "")
  return `${units / amountScale}${fraction ? `.${fraction}` : ""}`
}

function milestoneGenerationError(error: unknown): string {
  if (error instanceof api.ApiError) {
    if (error.status === 401) return "Your session has expired. Sign in to generate milestones."
    if (error.status === 403) return "Only clients can generate milestones."
    if (error.status === 400) return "Check the work description, agreement amount, title and duration."
    if (error.status === 429) return "Too many generation requests. Wait before trying again."
    switch (error.code) {
      case "AI_TIMEOUT": return "Milestone generation timed out. Try again or enter milestones manually."
      case "AI_QUOTA_EXCEEDED": return "The AI service has reached its quota. Try again later or enter milestones manually."
      case "AI_INVALID_OUTPUT": return "The AI service returned an invalid plan. Try again or enter milestones manually."
      case "AI_UNAVAILABLE": return "AI generation is currently unavailable. You can enter milestones manually."
      case "NETWORK_ERROR": return "Could not reach SecureEscrow. Check your connection and try again."
    }
  }
  return "Could not generate milestones. Try again or enter milestones manually."
}

export function CreateEscrowModal({ open, onClose, onCreated, clientId, providerUsers, providersLoading, retryProviders }: {
  open: boolean; onClose: () => void
  onCreated: (escrowId: string, meta: { domain: string; releaseModel: ReleaseModel }) => void
  clientId: string; providerUsers: BackendUser[]
  providersLoading?: boolean; retryProviders?: () => void
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    providerId: "",
    domain: "Freelancing",
    releaseModel: "Milestone Based" as ReleaseModel,
    totalAmount: "",
  })
  const [conditions, setConditions] = useState<ConditionDraft[]>([
    { draftId: genId(), title: "Work submitted", description: "The provider submits the agreed work.", type: "WORK_SUBMITTED", required: true, config: { actorRole: "PAYEE" } },
    { draftId: genId(), title: "Payer approval", description: "The payer approves the submitted work.", type: "CLIENT_APPROVAL", required: true, config: { actorRole: "PAYER" } },
  ])
  const [editingConditionId, setEditingConditionId] = useState<string | null>(null)
  const [milestones, setMilestones] = useState<MilestoneForm[]>([{ id: genId(), title: "", amount: "", description: "" }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerSearch, setProviderSearch] = useState("")
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [workDescription, setWorkDescription] = useState("")
  const [duration, setDuration] = useState("")
  const [activeGeneration, setActiveGeneration] = useState<AbortController | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [assumptions, setAssumptions] = useState<string[] | null>(null)
  const generation = useRef<AbortController | null>(null)
  const generating = Boolean(activeGeneration && !activeGeneration.signal.aborted)
  const invalidateGeneration = () => {
    const active = generation.current
    generation.current = null
    active?.abort()
    setActiveGeneration(null)
    setGenerationError(null)
  }
  const setF = (k: string, v: string) => {
    invalidateGeneration()
    setForm(f => ({ ...f, [k]: v }))
  }
  const editMilestones = (update: (draft: MilestoneForm[]) => MilestoneForm[]) => {
    invalidateGeneration()
    setMilestones(update)
  }
  const updateM = (id: string, k: keyof MilestoneForm, v: string) => editMilestones(m => m.map(x => x.id === id ? { ...x, [k]: v } : x))
  const updateConditionDraft = (draftId: string, draft: ConditionDraft) => setConditions(items => items.map(item => item.draftId === draftId ? { ...draft, draftId } : item))
  const conditionInput = (draft: ConditionDraft): api.ConditionInput => {
    const config = { ...draft.config }
    if (draft.type === "DEADLINE_REACHED" && config.deadline) config.deadline = new Date(String(config.deadline)).toISOString()
    return { title: draft.title.trim(), description: draft.description.trim(), type: draft.type, required: draft.required, config }
  }
  const agreementUnits = escrowUnits(form.totalAmount)
  const milestoneUnits = milestones.reduce((sum, m) => sum + (escrowUnits(m.amount) ?? 0n), 0n)
  const totalAmount = form.releaseModel === "Milestone Based"
    ? Number(escrowDecimal(agreementUnits ?? 0n))
    : parseFloat(form.totalAmount) || 0
  const projectDays = duration === "" ? undefined : Number(duration)
  const providerId = form.providerId || providerUsers[0]?.id || ""
  const canGenerate = Boolean(agreementUnits && workDescription.trim() && workDescription.trim().length <= 4000
    && form.title.trim().length <= 120
    && (projectDays === undefined || (Number.isInteger(projectDays) && projectDays >= 1 && projectDays <= 3650)))
  const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-400"
  const filteredProviders = providerUsers.filter(provider => {
    const search = providerSearch.trim().toLowerCase()
    if (!search) return true
    return [provider.name, provider.username, provider.email].some(value => value?.toLowerCase().includes(search))
  })

  useEffect(() => {
    return () => {
      const active = generation.current
      generation.current = null
      active?.abort()
    }
  }, [open])

  const handleGenerate = async () => {
    if (!canGenerate || !agreementUnits || submitting || generation.current) return
    if ((assumptions || milestones.some(m => m.title.trim() || m.amount || m.description.trim()))
      && !window.confirm("Replace the current milestones with a new AI-generated plan?")) return
    const active = new AbortController()
    generation.current = active
    setActiveGeneration(active)
    setGenerationError(null)
    try {
      const draft = await api.generateMilestones({
        title: form.title.trim() || undefined,
        description: workDescription.trim(),
        totalAmount: escrowDecimal(agreementUnits),
        durationDays: projectDays,
      }, active.signal)
      if (generation.current !== active) return
      const rows = draft.milestones.map(m => ({
        id: genId(), title: m.title, description: m.description, amount: m.amount.toFixed(8),
      }))
      const allocations = rows.map(m => escrowUnits(m.amount))
      if (!rows.length || allocations.some(units => units === null)
        || escrowUnits(draft.totalAmount.toFixed(8)) !== agreementUnits
        || allocations.reduce<bigint>((sum, units) => sum + (units ?? 0n), 0n) !== agreementUnits) {
        setGenerationError("The generated plan does not match the agreement amount. Try again or enter milestones manually.")
        return
      }
      setMilestones(rows.map((m, index) => ({ ...m, amount: escrowDecimal(allocations[index]!) })))
      setForm(current => ({
        ...current,
        title: current.title.trim() ? current.title : draft.title,
        description: current.description.trim() ? current.description : draft.description,
      }))
      setAssumptions(draft.assumptions)
    } catch (err) {
      if (generation.current === active) setGenerationError(milestoneGenerationError(err))
    } finally {
      if (generation.current === active) {
        generation.current = null
        setActiveGeneration(null)
      }
    }
  }

  const resetForm = () => {
    invalidateGeneration()
    setAssistantOpen(false)
    setWorkDescription("")
    setDuration("")
    setAssumptions(null)
    setForm({
      title: "",
      description: "",
      providerId: "",
      domain: "Freelancing",
      releaseModel: "Milestone Based",
      totalAmount: "",
    })
    setConditions([
      { draftId: genId(), title: "Work submitted", description: "The provider submits the agreed work.", type: "WORK_SUBMITTED", required: true, config: { actorRole: "PAYEE" } },
      { draftId: genId(), title: "Payer approval", description: "The payer approves the submitted work.", type: "CLIENT_APPROVAL", required: true, config: { actorRole: "PAYER" } },
    ])
    setEditingConditionId(null)
    setMilestones([{ id: genId(), title: "", amount: "", description: "" }])
    setError(null)
    setProviderSearch("")
  }

  const handleClose = () => { if (!submitting) { resetForm(); onClose() } }

  const changeReleaseModel = (next: ReleaseModel) => {
    if (next === form.releaseModel) return
    const currentCount = form.releaseModel === "Milestone Based" ? milestones.length : conditions.length
    if (currentCount && !window.confirm(`Switching to ${next} clears the current ${form.releaseModel === "Milestone Based" ? "milestone configuration" : "condition configuration"}. Continue?`)) return
    invalidateGeneration()
    setAssumptions(null)
    if (next === "Condition Based") { setMilestones([]); setConditions([]) }
    else { setConditions([]); setMilestones([{ id: genId(), title: "", amount: "", description: "" }]) }
    setForm(current => ({ ...current, releaseModel: next }))
    setEditingConditionId(null)
  }

  const handleSubmit = async () => {
    if (!providerId) { setError("Select a provider for this escrow."); return }
    if (form.releaseModel === "Milestone Based" && !agreementUnits) { setError("Enter a positive agreement amount up to ₹50,000,000 with at most eight decimal places."); return }
    if (form.releaseModel === "Milestone Based" && milestones.some(m => !m.title.trim() || !m.description.trim() || !escrowUnits(m.amount))) { setError("Every milestone needs a title, description, and positive amount with at most eight decimal places."); return }
    if (form.releaseModel === "Milestone Based" && milestoneUnits !== agreementUnits) { setError("Milestone amounts must equal the agreement amount."); return }
    if (form.releaseModel === "Condition Based" && conditions.length === 0) { setError("Add at least one release condition."); return }
    if (form.releaseModel === "Condition Based" && conditions.some(c => !c.title.trim() || !c.description.trim() || (c.type === "DEADLINE_REACHED" && (!c.config.deadline || Number.isNaN(Date.parse(String(c.config.deadline))))) || (c.type === "EXTERNAL_VERIFICATION" && !String(c.config.verificationSource ?? "").trim()))) { setError("Complete each condition title, description, and required configuration."); return }
    if (totalAmount <= 0) { setError("Enter an escrow amount greater than 0."); return }
    invalidateGeneration()
    setSubmitting(true)
    setError(null)
    try {
      // Create the escrow on the real backend first…
      const escrow = await api.createEscrow({
        title: form.title || "New Escrow",
        description: form.description,
        clientId,
        freelancerId: providerId,
        participants: [{ userId: clientId, role: "PAYER" }, { userId: providerId, role: "PAYEE" }],
        totalAmount,
        releaseModel: form.releaseModel === "Milestone Based" ? "MILESTONE_BASED" : "CONDITION_BASED",
        ...(form.releaseModel === "Milestone Based" ? { milestones: milestones.map(m => ({ title: m.title, description: m.description, amount: Number(m.amount) })) } : {}),
        conditions: form.releaseModel === "Condition Based" ? conditions.map(conditionInput) : [],
        agreementType: form.domain,
        terms: form.description,
      })
      const meta = {
        domain: form.domain,
        releaseModel: form.releaseModel,
      }
      resetForm()
      onClose()
      onCreated(escrow.id, meta)
    } catch (err) {
      setError(extractApiErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} wide>
      <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
        <div><h2 className="font-bold text-slate-900">Create Escrow</h2><p className="text-xs text-slate-400 mt-0.5">Configure a new escrow agreement</p></div>
        <button aria-label="Close Create Escrow" onClick={handleClose} className="text-slate-400 hover:text-slate-600"><XIcon /></button>
      </div>
      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
            <span className="mt-0.5 font-bold">!</span><span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1.5">Escrow Title</label><input className={inputCls} placeholder="e.g. Website Development" value={form.title} onChange={e => setF("title", e.target.value)} /></div>
          <label className="col-span-2 block text-xs font-medium text-slate-600">Description<textarea className={`${inputCls} mt-1.5 resize-none`} rows={2} value={form.description} onChange={e => setF("description", e.target.value)} /></label>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Domain</label>
              <input className={inputCls} list="agreement-types" value={form.domain} onChange={e => setF("domain", e.target.value)} placeholder="e.g. Equipment sale" />
              <datalist id="agreement-types">
                <option value="Freelancing" /><option value="Rentals" /><option value="Marketplace" />
                <option value="B2B Services" /><option value="Digital Services" />
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Release Model</label>
              <select
                aria-label="Release model"
                className={inputCls}
                value={form.releaseModel}
                onChange={e => changeReleaseModel(e.target.value as ReleaseModel)}
              >
                <option value="Milestone Based">Milestone Based</option>
                <option value="Condition Based">Condition Based</option>
              </select>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-slate-800">Choose a provider</p><p className="mt-0.5 text-xs text-slate-500">Select the professional who will deliver this agreement.</p></div>
            {providerId && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{providerUsers.length} available</span>}
          </div>
          <label className="mb-3 block">
            <span className="sr-only">Search providers</span>
            <input aria-label="Search providers" className={inputCls} type="search" value={providerSearch} onChange={event => setProviderSearch(event.target.value)} placeholder="Search by name, username or email" />
          </label>
          {providersLoading ? <p role="status" className="py-4 text-sm text-slate-500">Loading providers…</p>
            : retryProviders ? <div className="space-y-2 py-4"><p role="alert" className="text-sm text-slate-600">Couldn’t load providers.</p><button type="button" className="text-sm font-medium text-blue-700 underline" onClick={retryProviders}>Retry</button></div>
            : providerUsers.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No providers are available yet.</div>
            : filteredProviders.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No providers match that search.</div>
              : <div role="group" aria-label="Available providers" className="grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredProviders.map(provider => {
                  const displayName = provider.name?.trim() || provider.username || provider.email || "Provider"
                  const initials = displayName.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()
                  const selected = providerId === provider.id
                  return <button key={provider.id} type="button" aria-pressed={selected} onClick={() => setF("providerId", provider.id)} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{initials || "P"}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{displayName}</span><span className="block truncate text-xs text-slate-500">{provider.email || provider.username || "Provider account"}</span></span>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${selected ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{selected ? "Selected" : "Provider"}</span>
                  </button>
                })}
              </div>}
        </div>
        {form.releaseModel === "Condition Based" && <div className="border-t border-slate-100 pt-5 space-y-3">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Release Conditions</p>
          <label className="block text-xs font-medium text-slate-600">Escrow amount (₹)<input className={`${inputCls} mt-1`} type="number" min="0.01" value={form.totalAmount} onChange={e => setF("totalAmount", e.target.value)} /></label>
          <p className="text-xs text-slate-500">All required conditions must be satisfied. Deadlines never release funds automatically.</p>
          {conditions.map((condition, index) => <div key={condition.draftId} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-800">{condition.title || `Condition ${index + 1}`}</p><p className="text-xs text-slate-500">{condition.type.replaceAll("_", " ")}{!condition.required ? " · Optional" : " · Required"}</p></div>
              <div className="flex gap-2"><Btn size="sm" variant="outline" onClick={() => setEditingConditionId(condition.draftId ?? null)}>Edit</Btn><button aria-label="Remove condition" className="text-slate-400 hover:text-red-600" onClick={() => setConditions(items => items.filter(item => item.draftId !== condition.draftId))}><TrashIcon /></button></div></div>
            {editingConditionId === condition.draftId && <div className="mt-3"><ConditionForm initial={condition} saving={false} onCancel={() => setEditingConditionId(null)} onSave={draft => { updateConditionDraft(condition.draftId!, draft); setEditingConditionId(null) }} /></div>}
          </div>)}
          <Btn variant="outline" size="sm" onClick={() => { const draftId = genId(); setConditions(items => [...items, { draftId, title: "", description: "", type: "PARTICIPANT_APPROVAL", required: true, config: { actorRole: "PAYER" } }]); setEditingConditionId(draftId) }}><PlusIcon size={12} /> Add Condition</Btn>
        </div>}
        {form.releaseModel === "Milestone Based" && <div className="border-t border-slate-100 pt-5">
          <label className="block text-xs font-medium text-slate-600 mb-4">Agreement amount (₹)<input className={`${inputCls} mt-1`} inputMode="decimal" value={form.totalAmount} onChange={e => setF("totalAmount", e.target.value)} /></label>
          {form.totalAmount && !agreementUnits && <p className="mb-3 text-xs text-red-700">Enter a positive amount up to ₹50,000,000 with at most eight decimal places.</p>}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Milestones</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-expanded={assistantOpen} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus:ring-2 focus:ring-blue-500" onClick={() => {
                if (assistantOpen) invalidateGeneration()
                else if (!workDescription) setWorkDescription(form.description)
                setAssistantOpen(!assistantOpen)
              }}>Generate with AI</button>
              <Btn variant="outline" size="sm" onClick={() => editMilestones(m => [...m, { id: genId(), title: "", amount: "", description: "" }])}><PlusIcon size={12} /> Add Milestone</Btn>
            </div>
          </div>
          {assistantOpen && <section aria-label="AI milestone assistant" className="mb-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">AI milestone assistant</h3>
            <p className="text-xs text-slate-600">Describe the scope and expected results. You can edit every suggestion before creating the agreement.</p>
            <p className="text-xs text-slate-700">An external AI service processes the work description, agreement title, budget and optional duration. Leave out secrets and sensitive information.</p>
            <label className="block text-xs font-medium text-slate-700">Describe the work
              <textarea className={`${inputCls} mt-1 bg-white`} rows={3} maxLength={4000} value={workDescription}
                placeholder="For example, inspect and restore two bicycles, then provide a list of replaced parts and proof of delivery."
                onChange={e => { invalidateGeneration(); setWorkDescription(e.target.value) }} />
            </label>
            <label className="block text-xs font-medium text-slate-700 sm:max-w-56">Expected duration in days (optional)
              <input className={`${inputCls} mt-1 bg-white`} type="number" min="1" max="3650" step="1" value={duration}
                onChange={e => { invalidateGeneration(); setDuration(e.target.value) }} />
            </label>
            {form.title.trim().length > 120 && <p className="text-xs text-red-700">Use 120 characters or fewer in the agreement title for AI generation.</p>}
            {projectDays !== undefined && (!Number.isInteger(projectDays) || projectDays < 1 || projectDays > 3650)
              && <p className="text-xs text-red-700">Enter a whole duration from 1 to 3,650 days.</p>}
            {generationError && <p role="alert" className="text-sm text-red-700">{generationError}</p>}
            {generating && <p role="status" className="text-sm text-blue-700">Generating milestone suggestions…</p>}
            <Btn size="sm" onClick={handleGenerate} disabled={!canGenerate || submitting} loading={generating}>
              {assumptions ? "Regenerate Suggestions" : "Generate Milestones"}
            </Btn>
          </section>}
          {assumptions && <div className="mb-4 space-y-1 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
            <p>Review and edit the AI-suggested milestones before creating the agreement.</p>
            {assumptions.length > 0 && <ul aria-label="AI assumptions" className="list-disc pl-4">{assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>}
          </div>}
          {agreementUnits && <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-live="polite">
            <span>Agreement ₹{escrowDecimal(agreementUnits)}</span>
            <span>Allocated ₹{escrowDecimal(milestoneUnits)}</span>
            {milestoneUnits > agreementUnits
              ? <span className="font-medium text-red-700">Over budget by ₹{escrowDecimal(milestoneUnits - agreementUnits)}</span>
              : <span>Unallocated ₹{escrowDecimal(agreementUnits - milestoneUnits)}</span>}
          </div>}
          <div className="space-y-3">
            {milestones.map((m, i) => (
              <div key={m.id} className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-slate-500">Milestone {i + 1}</p>
                  <button aria-label="Remove milestone" onClick={() => editMilestones(ms => ms.filter(x => x.id !== m.id))} className="text-slate-400 hover:text-red-500 transition-colors"><TrashIcon /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-slate-600 mb-1.5">Title</label><input className={inputCls} placeholder="e.g. Design Phase" value={m.title} onChange={e => updateM(m.id, "title", e.target.value)} /></div>
                  <label className="block text-xs font-medium text-slate-600">Amount (₹)<input className={`${inputCls} mt-1.5 font-mono`} inputMode="decimal" placeholder="0" value={m.amount} onChange={e => updateM(m.id, "amount", e.target.value)} /></label>
                  <label className="col-span-2 block text-xs font-medium text-slate-600">Completion details<textarea className={`${inputCls} mt-1.5`} rows={m.description.includes("\n") ? 7 : 2} placeholder="What must be completed for approval?" value={m.description} onChange={e => updateM(m.id, "description", e.target.value)} /></label>
                </div>
              </div>
            ))}
          </div>
        </div>}
        {form.releaseModel === "Milestone Based" && <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs text-blue-700">
          <span className="mt-0.5 font-bold">ℹ</span>
          <span>Funds are held securely and released after milestone approval.</span>
        </div>}
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
        {totalAmount > 0 && <p className="text-sm text-slate-500">Total: <span className="font-mono font-semibold text-slate-900">{form.releaseModel === "Milestone Based" && agreementUnits ? `₹${escrowDecimal(agreementUnits)}` : fmt(totalAmount)}</span></p>}
        <div className="flex gap-2 ml-auto">
          <Btn variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Btn>
          <Btn onClick={handleSubmit} loading={submitting}>Create Escrow</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Release Payment Modal ────────────────────────────────────────────────────

function ReleasePaymentModal({ open, onClose, onConfirm, loading, success, milestone, providerName }: {
  open: boolean; onClose: () => void; onConfirm: () => void; loading: boolean; success: boolean
  milestone: Milestone | null; providerName: string
}) {
  if (!milestone) return null
  return (
    <Modal open={open} onClose={!loading ? onClose : () => {}}>
      {success ? (
        <div className="px-8 py-10 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5 text-emerald-600"><CheckIcon size={28} /></div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Payment Released Successfully</h2>
          <p className="text-3xl font-bold font-mono text-emerald-600 mb-1">{fmt(milestone.amount)}</p>
          <p className="text-sm text-slate-500 mb-6">Escrow → {providerName}</p>
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-5 py-4 text-left mb-6 space-y-2">
            {["Transaction completed", "Ledger updated", "Escrow closed"].map(s => (
              <div key={s} className="flex items-center gap-2 text-sm text-slate-700">
                <div className="w-4 h-4 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600"><CheckIcon size={8} /></div>
                {s}
              </div>
            ))}
          </div>
          <Btn onClick={onClose} className="w-full justify-center">Done</Btn>
        </div>
      ) : (
        <>
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Release Payment?</h2>
            {!loading && <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><XIcon /></button>}
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600">You are about to release <span className="font-semibold font-mono text-slate-900">{fmt(milestone.amount)}</span> from the escrow account to the provider.</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              {[["From", "Escrow Account", shortId(milestone.id)], ["To", providerName, "Provider account"], ["Amount", fmt(milestone.amount), "Full milestone amount"]].map(([l, v, s]) => (
                <div key={l} className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 last:border-0">
                  <p className="text-xs text-slate-400 font-medium">{l}</p>
                  <div className="text-right"><p className="text-sm font-semibold text-slate-800">{v}</p><p className="text-xs text-slate-400 font-mono">{s}</p></div>
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">This action is irreversible for this milestone. Other milestones in the same escrow remain independent.</div>
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <Btn variant="secondary" onClick={onClose} disabled={loading}>Cancel</Btn>
            <Btn onClick={onConfirm} loading={loading}>Confirm Release</Btn>
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const auth = useAuth()
  // ─── Backend-sourced state ──────────────────────────────────────────────
  const [directory, setDirectory] = useState<{ session: string; users: BackendUser[] | null } | null>(null)
  const [directoryAttempt, setDirectoryAttempt] = useState(0)
  const directorySession = auth.user ? auth.token : null
  const activeDirectory = directory?.session === directorySession ? directory : null
  const users = useMemo(() => activeDirectory?.users ?? [], [activeDirectory])

  const [rawEscrows, setRawEscrows] = useState<api.EscrowWithReleaseItems[]>([])
  const [clientAccount, setClientAccount] = useState<BackendAccount | null>(null)
  const [providerAccount, setProviderAccount] = useState<BackendAccount | null>(null)
  const [escrowAccount, setEscrowAccount] = useState<BackendAccount | null>(null)
  const [rawTransactions, setRawTransactions] = useState<BackendTransaction[]>([])
  const [rawLedgerEntries, setRawLedgerEntries] = useState<BackendLedgerEntry[]>([])
  const [ledgerSummary, setLedgerSummary] = useState<{ totalDebits: number; totalCredits: number; balanced: boolean; transactionsValidated: number } | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)

  // Keep the selected UI domain label alongside the backend agreement type.
  const [escrowMeta, setEscrowMeta] = useState<Record<string, { domain: string; releaseModel: ReleaseModel }>>({})

  // ─── UI-only state ──────────────────────────────────────────────────────
  const [loginError, setLoginError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>("dashboard")
  const [selectedEscrowId, setSelectedEscrowId] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [releaseModal, setReleaseModal] = useState<{ milestoneId: string; escrowId: string } | null>(null)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [releaseSuccess, setReleaseSuccess] = useState(false)

  const currentRole = auth.user?.role ?? null
  // Keep the normalized identity stable across dashboard data updates.
  // Recreating this object on every render retriggered the authentication
  // refresh effect whenever refreshAll toggled its loading state.
  const authenticatedUser = useMemo(() => auth.user ? api.normalizeUser(auth.user) : null, [auth.user])
  const clientUser = currentRole === "CLIENT" ? authenticatedUser ?? undefined : users.find(u => u.type === "CLIENT")
  const providerUser = currentRole === "PROVIDER" ? authenticatedUser ?? undefined : users.find(u => u.type === "PROVIDER")
  const availableProviders = users.filter(u => (u.role ?? u.type) === "PROVIDER" && u.isActive !== false)
  const userName = useCallback((id: string) => {
    const user = users.find(u => u.id === id)
    return user?.name ?? user?.username ?? user?.email ?? id
  }, [users])
  const accountLabel = useCallback((accountId: string) => {
    if (accountId === clientAccount?.id) return `${clientUser?.name ?? "Client"} Account`
    if (accountId === providerAccount?.id) return `${providerUser?.name ?? "Provider"} Account`
    if (accountId === escrowAccount?.id || accountId === api.ESCROW_ACCOUNT_ID) return "Escrow Account"
    if (accountId === "account-clearing") return "External Clearing (Demo)"
    return accountId
  }, [clientAccount, providerAccount, escrowAccount, clientUser, providerUser])

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = genId()
    setToasts(prev => [...prev, { ...t, id }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000)
  }, [])
  const dismissToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  // ─── Load real backend users (drives the Account Selection page) ───────
  useEffect(() => {
    if (!directorySession) return
    const controller = new AbortController()
    void api.getUsers(controller.signal).then(
      users => {
        if (!controller.signal.aborted) setDirectory({ session: directorySession, users })
      },
      () => {
        if (!controller.signal.aborted) setDirectory({ session: directorySession, users: null })
      },
    )
    return () => controller.abort()
  }, [directorySession, directoryAttempt])

  const retryDirectory = () => {
    setDirectory(null)
    setDirectoryAttempt(attempt => attempt + 1)
  }

  const handleLogin = useCallback(async (email: string, password: string) => {
    setLoginError(null)
    try {
      await auth.login(email, password)
      setPage("dashboard")
      setSelectedEscrowId(null)
    } catch (err) {
      setLoginError(extractApiErrorMessage(err))
    }
  }, [auth])

  const handleRegister = useCallback(async (data: { username: string; email: string; password: string; role: "CLIENT" | "PROVIDER" }) => {
    await auth.register(data)
  }, [auth])

  // ─── Refresh escrows + accounts + transactions + ledger from the backend.
  // Called on login and after every state-changing action, per the "Data
  // Refresh Strategy" — the backend stays the single source of truth. ───
  const refreshAll = useCallback(async () => {
    if (!authenticatedUser || !currentRole) return
    setDataLoading(true)
    setDataError(null)
    try {
      const validation = currentRole === "ADMIN" ? await api.validateLedger() : null
      const escrowsWithMilestones = await api.getAllEscrowsWithReleaseItems(currentRole === "ADMIN")
      const ownAccount = currentRole === "ADMIN" ? null : await api.getAccountByUserId(authenticatedUser.id)
      const escrowAcc = currentRole === "ADMIN" && validation?.escrowHeld === undefined
        ? await api.getAccountById(api.ESCROW_ACCOUNT_ID)
        : null
      setRawEscrows(escrowsWithMilestones)
      setClientAccount(currentRole === "CLIENT" ? ownAccount : null)
      setProviderAccount(currentRole === "PROVIDER" ? ownAccount : null)
      setEscrowAccount(escrowAcc)
      setLedgerSummary(validation ? { totalDebits: validation.results.reduce((s, r) => s + r.totalDebits, 0), totalCredits: validation.results.reduce((s, r) => s + r.totalCredits, 0), balanced: validation.allBalanced, transactionsValidated: validation.totalTransactions } : null)

      const [escrowTransactions, accountTransactions] = await Promise.all([
        api.getAllTransactionsForEscrows(escrowsWithMilestones.map(e => e.id)),
        ownAccount ? api.getAccountTransactions(ownAccount.id) : Promise.resolve([]),
      ])
      const txns = [...new Map([...escrowTransactions, ...accountTransactions].map(tx => [tx.id, tx])).values()]
        .sort((a, b) => a.createdAt - b.createdAt)
      setRawTransactions(txns)
      setRawLedgerEntries(await api.getAllLedgerEntriesForTransactions(txns.map(t => t.id)))
    } catch (err) {
      setDataError(extractApiErrorMessage(err))
    } finally {
      setDataLoading(false)
    }
  }, [authenticatedUser, currentRole])

  useEffect(() => {
    if (currentRole && authenticatedUser) void refreshAll()
  }, [refreshAll, currentRole, authenticatedUser])

  // ─── Derived, display-ready data (mapped from real backend shapes) ─────
  const escrows: Escrow[] = rawEscrows.map(e => {
    const milestones: Milestone[] | undefined = e.milestones?.map(m => ({
      id: m.id, title: m.title, amount: m.amount, description: m.description, state: m.status, order: m.order,
      submissions: m.submissions, reviewFeedback: m.reviewFeedback,
    }))
    const meta = escrowMeta[e.id] ?? { domain: e.agreementType ?? "General", releaseModel: (e.releaseModel === "CONDITION_BASED" ? "Condition Based" : "Milestone Based") as ReleaseModel }
    return {
      id: e.id, title: e.title, description: e.description, domain: meta.domain,
      providerName: userName(e.freelancerId), providerId: e.freelancerId, clientId: e.clientId,
      totalAmount: e.totalAmount, releaseModel: meta.releaseModel,
      state: e.releaseModel === "CONDITION_BASED" || !milestones || ["DISPUTED", "RELEASED", "CANCELLED", "RESOLVED"].includes(e.status) ? e.status as EscrowState : deriveEscrowState(milestones), ...(milestones ? { milestones } : {}), conditions: e.releaseEligibility?.conditions ?? e.conditions ?? [], disputes: e.disputes ?? [],
      releaseEligible: e.releaseEligibility?.eligible ?? false, releaseBlockedReason: e.releaseEligibility?.reason ?? "Escrow is not fully funded", createdAt: fmtTime(e.createdAt),
      disputed: Boolean(e.disputed || e.status === "DISPUTED"),
    }
  })

  const transactions: Transaction[] = rawTransactions.map(t => ({
    id: t.id, type: t.type, escrowId: t.escrowId,
    escrowTitle: rawEscrows.find(e => e.id === t.escrowId)?.title ?? (t.type === "DEPOSIT" ? "Account deposit" : t.type === "WITHDRAWAL" ? "Account withdrawal" : "Escrow transaction"),
    milestoneId: t.milestoneId ?? "", amount: t.amount,
    from: accountLabel(t.fromAccountId), to: accountLabel(t.toAccountId),
    fromAccountId: t.fromAccountId, toAccountId: t.toAccountId,
    status: t.status, timestamp: fmtTime(t.createdAt),
  }))

  const ledger: LedgerEntry[] = rawLedgerEntries.map(entry => ({
    txId: entry.transactionId,
    txType: rawTransactions.find(t => t.id === entry.transactionId)?.type ?? "FUND",
    account: accountLabel(entry.accountId), entryType: entry.type, amount: entry.amount, balance: entry.balance,
  }))

  const selectedEscrow = selectedEscrowId
    ? escrows.find(e => e.id === selectedEscrowId)
    : undefined

  const selectedHasActiveDispute = rawEscrows.find(escrow => escrow.id === selectedEscrowId)?.disputes?.some(dispute => dispute.status !== "RESOLVED") ?? false
  useEffect(() => {
    if (!currentRole || !selectedEscrowId || !selectedHasActiveDispute) return
    const timer = window.setInterval(() => { void refreshAll() }, 6000)
    return () => window.clearInterval(timer)
  }, [currentRole, selectedEscrowId, selectedHasActiveDispute, refreshAll])

  const awaitingSubmission = currentRole === "CLIENT" && page === "escrow" && !selectedHasActiveDispute
    && (selectedEscrow?.milestones?.some(milestone => ["FUNDED", "IN_PROGRESS"].includes(milestone.state)) ?? false)
  useEffect(() => {
    if (!awaitingSubmission || !selectedEscrowId || loadingAction) return
    let active = true
    let pending = false
    const refreshMilestones = async () => {
      if (pending) return
      pending = true
      try {
        const latest = await api.getMilestonesByEscrow(selectedEscrowId)
        if (!active) return
        setRawEscrows(rows => rows.map(escrow => {
          if (escrow.id !== selectedEscrowId) return escrow
          const current = new Map(escrow.milestones?.map(milestone => [milestone.id, milestone]))
          return { ...escrow, milestones: latest.map(milestone => {
            const previous = current.get(milestone.id)
            return previous && previous.updatedAt > milestone.updatedAt ? previous : milestone
          }) }
        }))
      } catch { /* Keep the last visible milestones and retry on the next poll. */ }
      finally { pending = false }
    }
    void refreshMilestones()
    const timer = window.setInterval(refreshMilestones, 6000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [awaitingSubmission, selectedEscrowId, loadingAction])

  // Default the selected escrow once data arrives.
  useEffect(() => {
    if (!selectedEscrow || selectedEscrow.releaseModel !== "Condition Based") return
    const nextDeadline = selectedEscrow.conditions
      .filter(c => c.type === "DEADLINE_REACHED" && c.status === "PENDING" && c.config.deadline)
      .map(c => Date.parse(String(c.config.deadline))).filter(time => time > Date.now()).sort((a, b) => a - b)[0]
    if (!nextDeadline) return
    const timer = window.setTimeout(() => { void refreshAll() }, Math.max(0, nextDeadline - Date.now() + 25))
    return () => window.clearTimeout(timer)
  }, [selectedEscrow, refreshAll])

  // ─── Actions — every one calls the real backend, then refreshes ────────
  const handleAction = useCallback(async (action: string, milestoneId: string, payload: { attachments?: { name: string; type: string; data: string }[]; feedback?: string } = {}) => {
    const escrow = rawEscrows.find(e => e.milestones?.some(m => m.id === milestoneId))
    if (!escrow) return
    if (action === "RELEASE") { setReleaseModal({ milestoneId, escrowId: escrow.id }); return }
    const key = `${milestoneId}-${action}`
    setLoadingAction(key)
    try {
      switch (action) {
        case "FUND": await api.fundMilestone(escrow.id, milestoneId); break
        case "START": await api.startMilestone(escrow.id, milestoneId); break
        case "SUBMIT": await api.submitMilestone(milestoneId, payload.attachments ?? []); break
        case "REVIEW": await api.reviewMilestone(milestoneId); break
        case "APPROVE": await api.approveMilestone(milestoneId); break
        case "REJECT": await api.rejectMilestone(milestoneId, payload.feedback ?? ""); break
        default: return
      }
      const titles: Record<string, string> = {
        FUND: "Milestone funded — provider can now start work.",
        START: "Work started — milestone is now in progress.",
        SUBMIT: "Work submitted for review.",
        REVIEW: "Review started — milestone is under review.",
        APPROVE: "Milestone approved — ready for payment release.",
        REJECT: "Revision requested — the provider can submit updated work.",
      }
      addToast({ type: "success", title: titles[action] ?? "Milestone updated." })
      await refreshAll()
    } catch (err) {
      addToast({ type: "error", title: "Action failed", message: extractApiErrorMessage(err) })
    } finally {
      setLoadingAction(null)
    }
  }, [rawEscrows, currentRole, addToast, refreshAll])

  const handleConfirmRelease = useCallback(async () => {
    if (!releaseModal) return
    setReleaseLoading(true)
    try {
      await api.releaseMilestone(releaseModal.milestoneId)
      setReleaseLoading(false)
      setReleaseSuccess(true)
      await refreshAll()
    } catch (err) {
      setReleaseLoading(false)
      setReleaseModal(null)
      addToast({ type: "error", title: "Release failed", message: extractApiErrorMessage(err) })
    }
  }, [releaseModal, clientUser, refreshAll, addToast])

  const handleConditionAction = useCallback(async (action: string) => {
    if (!selectedEscrow) return
    setLoadingAction(`${selectedEscrow.id}-${action}`)
    try {
      if (action === "FUND") await api.fundConditionEscrow(selectedEscrow.id)
      else if (action === "RELEASE") await api.releaseConditionEscrow(selectedEscrow.id)
      else throw new Error("Unsupported condition action")
      await refreshAll()
      addToast({ type: "success", title: action === "RELEASE" ? "Funds released" : "Escrow funded" })
    } catch (err) {
      addToast({ type: "error", title: "Action failed", message: extractApiErrorMessage(err) })
    } finally { setLoadingAction(null) }
  }, [selectedEscrow, currentRole, clientUser, providerUser, refreshAll, addToast])

  const handleDisputeCreate = useCallback(async (input: { title: string; category: DisputeCategory; description: string; requestedResolution: RequestedResolution; milestoneId?: string }) => {
    if (!selectedEscrow || currentRole === "ADMIN") return
    const actorId = currentRole === "CLIENT" ? clientUser?.id : providerUser?.id
    if (!actorId) return
    setLoadingAction("dispute-create")
    try {
      await api.createEscrowDispute(selectedEscrow.id, input)
      await refreshAll()
      addToast({ type: "success", title: "Dispute submitted", message: "The dispute is now visible to both participants." })
    } catch (err) {
      addToast({ type: "error", title: "Dispute could not be submitted", message: extractApiErrorMessage(err) })
      throw err
    } finally { setLoadingAction(null) }
  }, [selectedEscrow, currentRole, clientUser, providerUser, refreshAll, addToast])

  const handleConditionCreate = useCallback(async (draft: ConditionDraft) => {
    if (!selectedEscrow || !clientUser) return
    const { draftId: _draftId, ...data } = draft
    setLoadingAction("condition-create")
    try { await api.createCondition(selectedEscrow.id, data); await refreshAll() }
    catch (err) { addToast({ type: "error", title: "Condition could not be added", message: extractApiErrorMessage(err) }) }
    finally { setLoadingAction(null) }
  }, [selectedEscrow, clientUser, refreshAll, addToast])

  const handleConditionUpdate = useCallback(async (id: string, draft: ConditionDraft) => {
    if (!clientUser) return
    const { draftId: _draftId, ...data } = draft
    setLoadingAction(`condition-${id}`)
    try { await api.updateCondition(id, data); await refreshAll() }
    catch (err) { addToast({ type: "error", title: "Condition could not be updated", message: extractApiErrorMessage(err) }) }
    finally { setLoadingAction(null) }
  }, [clientUser, refreshAll, addToast])

  const handleConditionDelete = useCallback(async (id: string) => {
    if (!clientUser) return
    setLoadingAction(`condition-${id}`)
    try { await api.deleteCondition(id); await refreshAll() }
    catch (err) { addToast({ type: "error", title: "Condition could not be removed", message: extractApiErrorMessage(err) }) }
    finally { setLoadingAction(null) }
  }, [clientUser, refreshAll, addToast])

  const handleConditionSatisfy = useCallback(async (id: string, evidence?: string) => {
    const actorId = currentRole === "CLIENT" ? clientUser?.id : providerUser?.id
    if (!actorId) return
    setLoadingAction(`condition-${id}`)
    try { await api.satisfyCondition(id, evidence); await refreshAll(); addToast({ type: "success", title: "Condition satisfied" }) }
    catch (err) { addToast({ type: "error", title: "Condition could not be completed", message: extractApiErrorMessage(err) }) }
    finally { setLoadingAction(null) }
  }, [currentRole, clientUser, providerUser, refreshAll, addToast])

  const handleConditionReviewWork = useCallback(async (id: string, decision: "APPROVE" | "REJECT", feedback?: string) => {
    if (!clientUser) return
    setLoadingAction(`condition-review-${id}`)
    try {
      await api.reviewWorkCondition(id, decision, feedback)
      await refreshAll()
      addToast({ type: "success", title: decision === "APPROVE" ? "Work approved" : "Revision requested" })
    } catch (err) {
      addToast({ type: "error", title: "Work review could not be saved", message: extractApiErrorMessage(err) })
    } finally { setLoadingAction(null) }
  }, [clientUser, refreshAll, addToast])

  const pendingWalletTransfers = useRef(new Map<string, string>())
  const handleAccountTransfer = useCallback(async (operation: "DEPOSIT" | "WITHDRAWAL", amount: number) => {
    const account = currentRole === "CLIENT" ? clientAccount : providerAccount
    const actorId = currentRole === "CLIENT" ? clientUser?.id : providerUser?.id
    if (!account || !actorId) return false
    const intent = JSON.stringify([actorId, account.id, operation, amount])
    let key = pendingWalletTransfers.current.get(intent)
    if (!key) {
      key = crypto.randomUUID()
      pendingWalletTransfers.current.set(intent, key)
    }
    try {
      const result = operation === "DEPOSIT"
        ? await api.depositToAccount(account.id, amount, key)
        : await api.withdrawFromAccount(account.id, amount, key)
      pendingWalletTransfers.current.delete(intent)
      await refreshAll()
      addToast({ type: "success", title: operation === "DEPOSIT" ? "Funds added" : "Withdrawal complete", message: `${fmt(result.transaction.amount)} ${operation === "DEPOSIT" ? "added to" : "withdrawn from"} your account.` })
      return true
    } catch (err) {
      if (err instanceof api.ApiError && err.status > 0 && err.status < 500) pendingWalletTransfers.current.delete(intent)
      addToast({ type: "error", title: operation === "DEPOSIT" ? "Deposit failed" : "Withdrawal failed", message: extractApiErrorMessage(err) })
      return false
    }
  }, [currentRole, clientAccount, providerAccount, clientUser, providerUser, refreshAll, addToast])

  const handleCloseRelease = useCallback(() => {
    if (releaseLoading) return
    if (releaseSuccess) addToast({ type: "success", title: "Payment released successfully", message: "Ledger has been updated." })
    setReleaseModal(null)
    setReleaseSuccess(false)
  }, [releaseLoading, releaseSuccess, addToast])

  const handleEscrowCreated = useCallback(async (escrowId: string, meta: { domain: string; releaseModel: ReleaseModel }) => {
    setEscrowMeta(prev => ({ ...prev, [escrowId]: meta }))
    addToast({ type: "success", title: "Escrow created", message: "It's ready to be funded." })
    await refreshAll()
    setSelectedEscrowId(escrowId)
    setPage("escrow")
  }, [refreshAll, addToast])

  const navigateToEscrow = useCallback((id: string) => {
    setSelectedEscrowId(id)
    setPage("escrow")
  }, [])

  const openEscrowList = useCallback(() => {
    setSelectedEscrowId(null)
    setPage("escrow")
  }, [])

  const handleSwitch = useCallback(() => {
    auth.logout()
    setPage("dashboard")
    setSelectedEscrowId(null)
  }, [auth])

  const releaseMilestone = releaseModal
    ? escrows.find(e => e.id === releaseModal.escrowId)?.milestones?.find(m => m.id === releaseModal.milestoneId) ?? null
    : null
  const releaseEscrow = releaseModal ? escrows.find(e => e.id === releaseModal.escrowId) : null

  // ─── Account selection (uses real backend users) ────────────────────────
  if (auth.isLoading) return <div className="min-h-screen flex items-center justify-center"><SpinnerIcon /><span className="ml-3">Checking session…</span></div>
  if (auth.restoreError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
      <p role="alert">We couldn’t verify your session. Try again when the server is available.</p>
      <div className="flex gap-3">
        <button className="rounded-md bg-slate-900 px-4 py-2 text-white" onClick={auth.retryRestore}>Retry</button>
        <button className="rounded-md border border-slate-300 px-4 py-2" onClick={auth.logout}>Sign out</button>
      </div>
    </div>
  )
  if (!currentRole || !authenticatedUser) return <LoginPage onLogin={handleLogin} onRegister={handleRegister} loading={auth.isLoading} error={loginError} />

  const user = authenticatedUser

  if (dataError && rawEscrows.length === 0 && !dataLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4"><XIcon size={22} /></div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Can't reach the backend</h1>
        <p className="text-slate-500 text-sm max-w-sm mb-6">{dataError}</p>
        <Btn onClick={refreshAll}>Retry</Btn>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar page={page} setPage={p => p === "escrow" ? openEscrowList() : setPage(p)} role={currentRole} user={user} onSwitch={handleSwitch} />

      {dataLoading && rawEscrows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <SpinnerIcon />
          <p className="text-slate-400 text-sm mt-3">Loading escrow data…</p>
        </div>
      ) : (
        <>
          {page === "dashboard" && currentRole === "ADMIN" && <AdminDashboardPage escrows={escrows} transactions={transactions} users={users} onViewEscrows={openEscrowList} onViewDisputes={() => setPage("disputes")} onViewTransactions={() => setPage("transactions")} onOpenEscrow={navigateToEscrow} />}
          {page === "disputes" && currentRole === "ADMIN" && <AdminDisputeManagement escrows={escrows} transactions={transactions} actorId={user.id} onRefresh={refreshAll} onOpenEscrow={navigateToEscrow} />}
          {page === "dashboard" && currentRole !== "ADMIN" && (
            <DashboardPage
              escrows={escrows} transactions={transactions} role={currentRole} user={user}
              clientName={clientUser?.name ?? "Test Client"}
              clientBalance={clientAccount?.balance ?? 0} providerBalance={providerAccount?.balance ?? 0}
              setPage={p => p === "escrow" ? openEscrowList() : setPage(p)} setSelectedEscrowId={navigateToEscrow}
              onCreateEscrow={() => setShowCreateModal(true)}
            />
          )}
          {page === "escrow" && selectedEscrow ? (
            <EscrowDetailsPage
              escrow={selectedEscrow} role={currentRole} clientName={clientUser?.name ?? "Test Client"}
              currentUserId={user.id} users={users}
              onAction={handleAction} onConditionAction={handleConditionAction}
              onConditionCreate={handleConditionCreate} onConditionUpdate={handleConditionUpdate}
              onConditionDelete={handleConditionDelete} onConditionSatisfy={handleConditionSatisfy} onConditionReviewWork={handleConditionReviewWork}
              onDisputeCreate={handleDisputeCreate}
              loadingAction={loadingAction}
              onBack={openEscrowList}
            />
          ) : page === "escrow" ? (
            <EscrowListPage escrows={escrows} role={currentRole} clientName={clientUser?.name ?? "Test Client"} setSelectedEscrowId={navigateToEscrow} onCreateEscrow={() => setShowCreateModal(true)} />
          ) : null}
          {page === "transactions" && (
            <TransactionsPage
              transactions={transactions}
              currentAccountId={currentRole === "ADMIN" ? undefined : currentRole === "CLIENT" ? (clientAccount?.id ?? "") : (providerAccount?.id ?? "")}
              onViewLedger={() => setPage("ledger")}
            />
          )}
          {page === "ledger" && <LedgerPage entries={ledger} summary={ledgerSummary} />}
          {page === "accounts" && (
            <AccountsPage
              key={user.id}
              currentAccountId={currentRole === "CLIENT" ? (clientAccount?.id ?? "") : (providerAccount?.id ?? "")}
              clientAccount={clientAccount} providerAccount={providerAccount}
              clientName={clientUser?.name ?? "Test Client"} providerName={providerUser?.name ?? "Test Provider"}
              onTransfer={handleAccountTransfer}
            />
          )}
        </>
      )}

      <CreateEscrowModal
        open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleEscrowCreated}
        clientId={clientUser?.id ?? "user-1"} providerUsers={availableProviders}
        providersLoading={Boolean(directorySession && !activeDirectory)}
        retryProviders={activeDirectory?.users === null ? retryDirectory : undefined}
      />
      <ReleasePaymentModal
        open={!!releaseModal} onClose={handleCloseRelease}
        onConfirm={handleConfirmRelease} loading={releaseLoading} success={releaseSuccess}
        milestone={releaseMilestone} providerName={releaseEscrow?.providerName ?? ""}
      />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
