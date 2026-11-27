import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"
import App, { AdminDisputeManagement, CreateEscrowModal, ConditionManagement, DisputeActivityPanel, DisputeEvidencePanel, EscrowDetailsPage } from "./App"
import { AuthProvider, useAuth } from "./auth/AuthContext"
import * as api from "./services/api"
import type { BackendCondition, BackendDispute, BackendDisputeEvidence, BackendUser } from "./services/api"

const provider: BackendUser = { id: "payee-1", name: "Provider", type: "PROVIDER", createdAt: 0 }

const sessionKey = `secureescrow.session:${api.API_BASE_URL}`
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  api.setAccessToken(null)
})

describe("dashboard initial data loading", () => {
  it("shows escrow, milestone, and account names in Transactions and Ledger", async () => {
    const user = { id: "payer-uuid", username: "Jordan Shah", email: "client@example.test", role: "CLIENT" as const }
    const wallet = { id: "payer-wallet-uuid", userId: user.id, balance: 100, currency: "INR", type: "PERSONAL" as const, createdAt: 0 }
    const escrowId = "escrow-uuid"
    const milestoneId = "milestone-uuid"
    const funding: api.BackendTransaction = {
      id: "funding-uuid", type: "FUND", status: "COMPLETED", amount: 100, escrowId, milestoneId,
      fromAccountId: wallet.id, toAccountId: "holding-wallet-uuid", createdAt: 1,
    }
    const release: api.BackendTransaction = {
      ...funding, id: "release-uuid", type: "RELEASE", fromAccountId: funding.toAccountId, toAccountId: "provider-wallet-uuid", createdAt: 2,
    }
    const deposit: api.BackendTransaction = {
      ...funding, id: "deposit-uuid", type: "DEPOSIT", escrowId: null, milestoneId: null,
      fromAccountId: "clearing-wallet-uuid", toAccountId: wallet.id, createdAt: 3,
    }
    window.sessionStorage.setItem(sessionKey, "saved-token")
    vi.spyOn(api, "me").mockResolvedValue(user)
    vi.spyOn(api, "getUsers").mockResolvedValue([{ ...provider, name: "Riya Rao" }])
    vi.spyOn(api, "getAccountByUserId").mockResolvedValue(wallet)
    vi.spyOn(api, "getAllEscrowsWithReleaseItems").mockResolvedValue([{
      id: escrowId, title: "PropSync", description: "", clientId: user.id, freelancerId: provider.id,
      totalAmount: 100, status: "RELEASED", releaseModel: "MILESTONE_BASED", createdAt: 0, updatedAt: 0,
      milestones: [{ id: milestoneId, escrowId, title: "Core workflows", description: "", amount: 100, status: "RELEASED", order: 1, createdAt: 0, updatedAt: 0 }],
    }])
    vi.spyOn(api, "getAllTransactionsForEscrows").mockResolvedValue([funding, release])
    vi.spyOn(api, "getAccountTransactions").mockResolvedValue([funding, deposit])
    vi.spyOn(api, "getAllLedgerEntriesForTransactions").mockResolvedValue([funding, release, deposit].flatMap(tx => [
      { id: tx.id + "-debit", transactionId: tx.id, accountId: tx.fromAccountId, type: "DEBIT", amount: tx.amount, balance: 0, createdAt: 0 },
      { id: tx.id + "-credit", transactionId: tx.id, accountId: tx.toAccountId, type: "CREDIT", amount: tx.amount, balance: 100, createdAt: 0 },
    ]))

    render(<AuthProvider><App /></AuthProvider>)
    fireEvent.click(await screen.findByRole("button", { name: "Transactions" }))
    const fundingRow = (await screen.findByRole("button", { name: "PropSync" })).closest("tr")!
    expect(within(fundingRow).getByText("Core workflows")).toBeInTheDocument()
    expect(within(fundingRow).getByText("Jordan Shah Account → Escrow Account")).toBeInTheDocument()
    expect(screen.getByText("External Clearing → Jordan Shah Account")).toBeInTheDocument()
    fireEvent.click(within(fundingRow).getByRole("button", { name: "PropSync" }))
    expect(screen.getByText("Details")).toBeInTheDocument()
    expect(screen.getAllByText("Core workflows")).toHaveLength(2)
    expect(document.body).not.toHaveTextContent(/funding-|release-|deposit-|escrow-u|-uuid|\bmileston\b/i)
    expect(screen.queryByText("Transaction ID")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "View Ledger Entries" }))
    const ledger = screen.getByRole("table")
    expect(await within(ledger).findByText("Riya Rao Account")).toBeInTheDocument()
    expect(within(ledger).getAllByText("PropSync")).toHaveLength(4)
    expect(within(ledger).getAllByText("Core workflows")).toHaveLength(4)
    expect(within(ledger).getByText("External Clearing")).toBeInTheDocument()
    expect(ledger).not.toHaveTextContent(/funding-|release-|deposit-|-uuid/i)
  })

  it("loads providers for escrow creation after restoring a client session", async () => {
    const user = { id: "restored-client", username: "client", email: "client@example.test", role: "CLIENT" as const }
    window.sessionStorage.setItem(sessionKey, "saved-client-token")
    vi.spyOn(api, "me").mockResolvedValue(user)
    const login = vi.spyOn(api, "login")
    let resolveDirectory!: (users: BackendUser[]) => void
    const directory = new Promise<BackendUser[]>(resolve => { resolveDirectory = resolve })
    const getUsers = vi.spyOn(api, "getUsers").mockReturnValue(directory)
    vi.spyOn(api, "getAllEscrowsWithReleaseItems").mockResolvedValue([])
    vi.spyOn(api, "getAccountByUserId").mockResolvedValue({ id: "restored-wallet", userId: user.id, balance: 0, currency: "INR", type: "PERSONAL", createdAt: 0 })
    vi.spyOn(api, "getAllTransactionsForEscrows").mockResolvedValue([])
    vi.spyOn(api, "getAccountTransactions").mockResolvedValue([])
    vi.spyOn(api, "getAllLedgerEntriesForTransactions").mockResolvedValue([])
    render(<AuthProvider><App /></AuthProvider>)
    fireEvent.click((await screen.findAllByRole("button", { name: /Create Escrow/ }))[0])
    expect(screen.getByText("Loading providers…")).toBeInTheDocument()
    expect(screen.queryByText("No providers are available yet.")).not.toBeInTheDocument()
    resolveDirectory([{ ...provider, name: "Available Provider" }])
    expect(await screen.findByRole("button", { name: /Available Provider/ })).toBeInTheDocument()
    expect(getUsers).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
  })

  it("refreshes the held escrow balance on the Accounts page", async () => {
    const user = { id: "held-client", username: "client", email: "client@example.test", role: "CLIENT" as const }
    vi.spyOn(api, "login").mockResolvedValue({ accessToken: "signed-token", user })
    vi.spyOn(api, "me").mockResolvedValue(user)
    vi.spyOn(api, "getUsers").mockResolvedValue([])
    vi.spyOn(api, "getAllEscrowsWithReleaseItems").mockResolvedValue([])
    vi.spyOn(api, "getAccountByUserId").mockResolvedValue({ id: "held-wallet", userId: user.id, balance: 200, currency: "INR", type: "PERSONAL", createdAt: 1 })
    vi.spyOn(api, "getAllTransactionsForEscrows").mockResolvedValue([])
    vi.spyOn(api, "getAccountTransactions").mockResolvedValue([])
    vi.spyOn(api, "getAllLedgerEntriesForTransactions").mockResolvedValue([])
    vi.spyOn(api, "getEscrowHeld")
      .mockResolvedValueOnce({ balance: 125.5, currency: "INR" })
      .mockResolvedValueOnce({ balance: 0, currency: "INR" })
    render(<AuthProvider><App /></AuthProvider>)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))
    fireEvent.click(await screen.findByRole("button", { name: "Accounts" }))
    expect(await screen.findByText("₹125.5")).toBeInTheDocument()
    fireEvent.focus(window)
    expect(await screen.findByText("₹0")).toBeInTheDocument()
  })

  it("loads a newly submitted provider file when the client opens the agreement", async () => {
    const user = { id: "file-client", username: "client", email: "client@example.test", role: "CLIENT" as const }
    const milestone: api.BackendMilestone = {
      id: "file-milestone", escrowId: "file-escrow", title: "Deliverable", description: "",
      amount: 100, status: "IN_PROGRESS", order: 1, createdAt: 1, updatedAt: 1,
    }
    const file = { name: "delivery.txt", type: "text/plain", data: "data:text/plain;base64,SGVsbG8=" }
    vi.spyOn(api, "login").mockResolvedValue({ accessToken: "signed-token", user })
    vi.spyOn(api, "me").mockResolvedValue(user)
    vi.spyOn(api, "getUsers").mockResolvedValue([provider])
    vi.spyOn(api, "getAllEscrowsWithReleaseItems").mockResolvedValue([{
      id: milestone.escrowId, title: "Delivery agreement", description: "", clientId: user.id, freelancerId: provider.id,
      totalAmount: 100, status: "IN_PROGRESS", releaseModel: "MILESTONE_BASED",
      createdAt: 1, updatedAt: 1, milestones: [milestone],
    }])
    const getMilestones = vi.spyOn(api, "getMilestonesByEscrow").mockResolvedValue([{
      ...milestone, status: "SUBMITTED", updatedAt: 2,
      submissions: [{ attachments: [file], submittedAt: 2, submittedBy: provider.id }],
    }])
    vi.spyOn(api, "getAccountByUserId").mockResolvedValue({ id: "file-wallet", userId: user.id, balance: 0, currency: "INR", type: "PERSONAL", createdAt: 0 })
    vi.spyOn(api, "getAllTransactionsForEscrows").mockResolvedValue([])
    vi.spyOn(api, "getAccountTransactions").mockResolvedValue([])
    vi.spyOn(api, "getAllLedgerEntriesForTransactions").mockResolvedValue([])
    render(<AuthProvider><App /></AuthProvider>)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "fixture" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))
    fireEvent.click(await screen.findByText("Delivery agreement"))
    await waitFor(() => expect(getMilestones).toHaveBeenCalledWith(milestone.escrowId))
    const attachment = await screen.findByRole("link", { name: file.name })
    expect(attachment).toHaveAttribute("download", file.name)
    expect(attachment).toHaveAttribute("href", file.data)
  })

  it("clears the authorization token from the API and tab storage on logout", async () => {
    const user = { id: "logout-user", username: "provider", email: "provider@example.test", role: "PROVIDER" as const }
    const setToken = vi.spyOn(api, "setAccessToken")
    vi.spyOn(api, "login").mockResolvedValue({ user, accessToken: "fixture-token" })
    vi.spyOn(api, "me").mockResolvedValue(user)
    function Session() {
      const auth = useAuth()
      return auth.user
        ? <button onClick={auth.logout}>End Session</button>
        : <button onClick={() => void auth.login(user.email, "fixture")}>Begin Session</button>
    }
    render(<AuthProvider><Session /></AuthProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Begin Session" }))
    const signOut = await screen.findByRole("button", { name: "End Session" })
    expect(window.sessionStorage.getItem(sessionKey)).toBe("fixture-token")
    fireEvent.click(signOut)
    expect(setToken.mock.calls).toEqual([["fixture-token"], [null]])
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull()
    expect(screen.getByRole("button", { name: "Begin Session" })).toBeInTheDocument()
  })

  it("restores a session after a reload with the saved bearer token", async () => {
    const user = { id: "saved-admin", username: "admin", email: "admin@example.test", role: "ADMIN" as const }
    window.sessionStorage.setItem(sessionKey, "saved-token")
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: user }), { status: 200 }))
    vi.stubGlobal("fetch", fetch)
    function Session() {
      const auth = useAuth()
      return <span>{auth.isLoading ? "Checking session" : auth.user?.role ?? "Sign in"}</span>
    }
    render(<AuthProvider><Session /></AuthProvider>)
    expect(screen.getByText("Checking session")).toBeInTheDocument()
    expect(screen.queryByText("Sign in")).not.toBeInTheDocument()
    expect(await screen.findByText("ADMIN")).toBeInTheDocument()
    expect(fetch.mock.calls[0][0]).toBe(api.API_BASE_URL + "/api/auth/me")
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer saved-token")
  })

  it("clears a saved token the backend rejects and returns to sign-in", async () => {
    window.sessionStorage.setItem(sessionKey, "expired-token")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Expired" }), { status: 401 })))
    render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByRole("button", { name: "Sign In" })).toBeInTheDocument()
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull()
  })

  it("preserves the session and lets you retry when the backend is unavailable", async () => {
    window.sessionStorage.setItem(sessionKey, "saved-token")
    const user = { id: "saved-client", username: "client", email: "client@example.test", role: "CLIENT" as const }
    const me = vi.spyOn(api, "me")
      .mockRejectedValueOnce(new api.ApiError("Unavailable", "NETWORK_ERROR", 0))
      .mockResolvedValueOnce(user)
    function Session() {
      const auth = useAuth()
      return auth.restoreError ? <button onClick={auth.retryRestore}>Retry</button> : <span>{auth.user?.username}</span>
    }
    render(<AuthProvider><Session /></AuthProvider>)
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
    expect(await screen.findByText("client")).toBeInTheDocument()
    expect(window.sessionStorage.getItem(sessionKey)).toBe("saved-token")
    expect(me).toHaveBeenCalledTimes(2)
  })

  it("loads once after login instead of repeating requests on loading-state renders", async () => {
    const user = { id: "client-1", username: "client1", email: "client@example.com", role: "CLIENT" as const }
    vi.spyOn(api, "login").mockResolvedValue({ accessToken: "signed-token", user })
    vi.spyOn(api, "me").mockResolvedValue(user)
    vi.spyOn(api, "getUsers").mockResolvedValue([
      { id: "provider-1", name: "Provider One", username: "provider-one", email: "one@example.com", role: "PROVIDER", type: "PROVIDER", createdAt: 0 },
      { id: "provider-2", name: "Provider Two", username: "provider-two", email: "two@example.com", role: "PROVIDER", type: "PROVIDER", createdAt: 0 },
    ])
    const loadEscrows = vi.spyOn(api, "getAllEscrowsWithReleaseItems").mockResolvedValue([])
    vi.spyOn(api, "getAccountByUserId").mockResolvedValue({ id: "account-1", userId: user.id, balance: 0, currency: "INR", type: "PERSONAL", createdAt: 0 })
    vi.spyOn(api, "getAllTransactionsForEscrows").mockResolvedValue([])
    vi.spyOn(api, "getAccountTransactions").mockResolvedValue([])
    vi.spyOn(api, "getAllLedgerEntriesForTransactions").mockResolvedValue([])

    render(<AuthProvider><App /></AuthProvider>)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }))

    await waitFor(() => expect(screen.getByText("Overview")).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole("button", { name: /Create Escrow/ })[0])
    expect(screen.getByRole("button", { name: /Provider One/ })).toBeInTheDocument()
    const secondProvider = screen.getByRole("button", { name: /Provider Two/ })
    expect(secondProvider).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(secondProvider)
    expect(secondProvider).toHaveAttribute("aria-pressed", "true")
    fireEvent.change(screen.getByRole("searchbox", { name: "Search providers" }), { target: { value: "one@example.com" } })
    expect(screen.getByRole("button", { name: /Provider One/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Provider Two/ })).not.toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(loadEscrows).toHaveBeenCalledTimes(1)
  })
})

describe("AI milestone assistant", () => {
  const chosenProvider = { ...provider, id: "payee-2", name: "Bicycle Workshop" }
  const details = "Restore the brakes.\n\nDeliverables:\n- Parts list\n\nAcceptance criteria:\n- Brakes pass inspection\n\nEstimated duration: 2 days"
  const draft = {
    title: "Bicycle restoration", description: "Inspect and restore a bicycle.", totalAmount: 0.3, assumptions: [],
    milestones: [
      { title: "Inspection", amount: 0.1, description: "Record the condition." },
      { title: "Restoration", amount: 0.2, description: details },
    ],
  }
  const change = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } })
  const button = (name: string) => screen.getByRole("button", { name })
  const amount = () => screen.getByLabelText(/Agreement amount/)
  const work = () => screen.getByLabelText("Describe the work")
  const milestoneTitle = () => screen.getAllByPlaceholderText("e.g. Design Phase")
  const milestoneAmount = () => screen.getAllByPlaceholderText("0")
  const submit = () => fireEvent.click(button("Create Escrow"))
  const start = () => fireEvent.click(button("Generate Milestones"))

  function openAssistant(populate = true) {
    render(<CreateEscrowModal open onClose={vi.fn()} onCreated={vi.fn()} clientId="payer-1" providerUsers={[provider, chosenProvider]} />)
    fireEvent.click(button("Generate with AI"))
    if (populate) {
      change(amount(), "0.30")
      change(work(), "Inspect and restore a bicycle.")
    }
  }

  it("requires valid inputs and offers the assistant only for milestone agreements", () => {
    openAssistant(false)
    expect(button("Generate Milestones")).toBeDisabled()
    change(work(), "Inspect and restore a bicycle.")
    change(amount(), "0.000000001")
    expect(button("Generate Milestones")).toBeDisabled()
    change(amount(), "0.30")
    const duration = screen.getByLabelText(/Expected duration/)
    change(duration, "1.5")
    expect(button("Generate Milestones")).toBeDisabled()
    change(duration, "5")
    expect(button("Generate Milestones")).toBeEnabled()
    vi.stubGlobal("confirm", vi.fn(() => true))
    change(screen.getByLabelText("Release model"), "Condition Based")
    expect(screen.queryByRole("button", { name: "Generate with AI" })).not.toBeInTheDocument()
    expect(screen.getByText("Release Conditions")).toBeInTheDocument()
  })

  it("uses the authenticated API and submits edited, balanced milestones only on confirmation", async () => {
    api.setAccessToken("client-token")
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ success: true, data: draft }))
    vi.stubGlobal("fetch", fetch)
    const create = vi.spyOn(api, "createEscrow").mockResolvedValue({ id: "escrow-1" } as api.BackendEscrow)
    openAssistant()
    const title = screen.getByPlaceholderText("e.g. Website Development")
    change(title, "My bicycle agreement")
    change(screen.getByLabelText("Description"), "My original agreement terms")
    change(screen.getByLabelText(/Expected duration/), "7")
    fireEvent.click(screen.getByRole("button", { name: /Bicycle Workshop/ }))
    start()
    expect(await screen.findByDisplayValue("Restoration")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, request] = fetch.mock.calls[0]
    expect(url).toBe(`${api.API_BASE_URL}/api/ai/generate-milestones`)
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer client-token")
    expect(request?.method).toBe("POST")
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(request?.body))).toEqual({
      title: "My bicycle agreement", description: "Inspect and restore a bicycle.", totalAmount: "0.3", durationDays: 7,
    })
    expect(create).not.toHaveBeenCalled()
    expect(title).toHaveValue("My bicycle agreement")
    expect(screen.getByLabelText("Description")).toHaveValue("My original agreement terms")
    expect(amount()).toHaveValue("0.30")
    expect(screen.getByRole("button", { name: /Bicycle Workshop/, pressed: true })).toBeInTheDocument()
    expect(screen.getByText("Unallocated ₹0")).toBeInTheDocument()
    change(milestoneTitle()[1], "Final restoration and handover")
    const completion = screen.getAllByLabelText("Completion details")[1]
    expect(completion).toHaveValue(details)
    change(completion, details + "\nInclude a signed checklist.")
    change(milestoneAmount()[1], "0.20000001")
    expect(screen.getByText("Over budget by ₹0.00000001")).toBeInTheDocument()
    submit()
    expect(screen.getByText("Milestone amounts must equal the agreement amount.")).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    change(milestoneAmount()[0], "0.09999999")
    submit()
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: "My bicycle agreement", description: "My original agreement terms", freelancerId: chosenProvider.id, totalAmount: 0.3,
      milestones: [
        { title: "Inspection", description: "Record the condition.", amount: 0.09999999 },
        { title: "Final restoration and handover", description: details + "\nInclude a signed checklist.", amount: 0.20000001 },
      ],
    })))
  })

  it("preserves the existing draft when the suggested amounts do not balance", async () => {
    vi.spyOn(api, "generateMilestones").mockResolvedValue({ ...draft, milestones: draft.milestones.slice(0, 1) })
    vi.stubGlobal("confirm", vi.fn(() => true))
    openAssistant()
    change(milestoneTitle()[0], "Manual milestone")
    start()
    expect(await screen.findByRole("alert")).toHaveTextContent("The generated plan does not match the agreement amount.")
    expect(milestoneTitle()[0]).toHaveValue("Manual milestone")
  })

  it("validates replacement confirmation and blocks duplicate requests", async () => {
    let resolve!: (value: api.GeneratedMilestoneDraft) => void
    const generate = vi.spyOn(api, "generateMilestones").mockImplementation(() => new Promise(done => { resolve = done }))
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    vi.stubGlobal("confirm", confirm)
    openAssistant()
    change(milestoneTitle()[0], "Manual inspection")
    start()
    expect(generate).not.toHaveBeenCalled()
    expect(milestoneTitle()[0]).toHaveValue("Manual inspection")
    start()
    expect(button("Generate Milestones")).toBeDisabled()
    start()
    expect(generate).toHaveBeenCalledTimes(1)
    resolve(draft)
    expect(await screen.findByDisplayValue("Inspection")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("e.g. Website Development")).toHaveValue(draft.title)
    expect(screen.getByLabelText("Description")).toHaveValue(draft.description)
    confirm.mockReturnValueOnce(false)
    fireEvent.click(button("Regenerate Suggestions"))
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it.each(["budget", "manual milestone", "release model", "close"])("ignores stale responses after a change to %s", async action => {
    let resolve!: (value: api.GeneratedMilestoneDraft) => void
    const generate = vi.spyOn(api, "generateMilestones").mockImplementation(() => new Promise(done => { resolve = done }))
    vi.stubGlobal("confirm", vi.fn(() => true))
    openAssistant()
    start()
    if (action === "budget") change(amount(), "2")
    if (action === "manual milestone") change(milestoneTitle()[0], "Keep this edit")
    if (action === "release model") change(screen.getByLabelText("Release model"), "Condition Based")
    if (action === "close") fireEvent.click(button("Cancel"))
    expect(generate.mock.calls[0][1].aborted).toBe(true)
    await act(async () => { resolve(draft) })
    expect(screen.queryByDisplayValue("Inspection")).not.toBeInTheDocument()
    if (action === "manual milestone") expect(milestoneTitle()[0]).toHaveValue("Keep this edit")
  })

  it.each([
    ["AI_TIMEOUT", 504, /timed out/],
    ["AI_RATE_LIMIT", 429, /Too many generation requests/],
    ["AI_UNAVAILABLE", 503, /currently unavailable/],
  ])("preserves the draft and permits manual creation after %s", async (code, status, message) => {
    vi.spyOn(api, "generateMilestones").mockRejectedValue(new api.ApiError("private provider error", code, status))
    const create = vi.spyOn(api, "createEscrow").mockResolvedValue({ id: "escrow-1" } as api.BackendEscrow)
    vi.stubGlobal("confirm", vi.fn(() => true))
    openAssistant()
    change(milestoneTitle()[0], "Manual restoration")
    change(milestoneAmount()[0], "0.30")
    change(screen.getByLabelText("Completion details"), "Signed checklist")
    start()
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(screen.queryByText("private provider error")).not.toBeInTheDocument()
    expect(milestoneTitle()[0]).toHaveValue("Manual restoration")
    expect(amount()).toHaveValue("0.30")
    expect(work()).toHaveValue("Inspect and restore a bicycle.")
    submit()
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      releaseModel: "MILESTONE_BASED", milestones: [{ title: "Manual restoration", amount: 0.3, description: "Signed checklist" }],
    })))
  })
})

describe("release-model condition and milestone forms", () => {
  it("shows milestone management only for the milestone release model", () => {
    render(<CreateEscrowModal open onClose={vi.fn()} onCreated={vi.fn()} clientId="payer-1" providerUsers={[provider]} />)
    expect(screen.getByText("Milestones")).toBeInTheDocument()
    expect(screen.queryByText("Release Conditions")).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("e.g. Design Phase"), { target: { value: "Unsaved milestone" } })

    vi.stubGlobal("confirm", vi.fn(() => true))
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Condition Based" } })
    expect(screen.queryByText("Milestones")).not.toBeInTheDocument()
    expect(screen.getByText("Release Conditions")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Add Condition/i })).toBeInTheDocument()

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Milestone Based" } })
    expect(screen.getByPlaceholderText("e.g. Design Phase")).toHaveValue("")
  })

  it("renders condition items independently with their own statuses", () => {
    const conditions: BackendCondition[] = [{
      id: "condition-1", escrowId: "escrow-1", title: "Inspection", description: "Inspection report received.",
      type: "EVIDENCE_SUBMITTED", config: { evidenceRequirement: "Inspection report" }, required: true,
      status: "PENDING", satisfiedAt: null, satisfiedBy: null, verificationDetails: null, createdAt: 1, updatedAt: 1,
    }]
    render(<ConditionManagement conditions={conditions} canEdit={false} canRespond role="PROVIDER" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={vi.fn()} onReviewWork={vi.fn()} busy={false} />)
    expect(screen.getByText("Inspection")).toBeInTheDocument()
    expect(screen.getByText("PENDING")).toBeInTheDocument()
    expect(screen.queryByText("Milestones")).not.toBeInTheDocument()
  })

  it("shows provider submission and client review actions for submitted work", () => {
    const work: BackendCondition = {
      id: "work-1", escrowId: "escrow-1", title: "Work submitted", description: "Provider submits work.",
      type: "WORK_SUBMITTED", config: { actorRole: "PAYER" }, required: true,
      status: "PENDING", satisfiedAt: null, satisfiedBy: null, verificationDetails: null, createdAt: 1, updatedAt: 1,
    }
    const submit = vi.fn()
    const review = vi.fn()
    const { rerender } = render(<ConditionManagement conditions={[work]} canEdit={false} canRespond role="CLIENT" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    expect(screen.queryByRole("button", { name: "Submit Work" })).not.toBeInTheDocument()

    rerender(<ConditionManagement conditions={[work]} canEdit={false} canRespond={false} role="PROVIDER" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    expect(screen.getByText(/available after the client successfully funds/i)).toBeInTheDocument()

    rerender(<ConditionManagement conditions={[work]} canEdit={false} canRespond role="PROVIDER" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    fireEvent.change(screen.getByPlaceholderText("Work link or submission evidence (required)"), { target: { value: "https://files.example/work.zip" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit Evidence" }))
    expect(submit).toHaveBeenCalledWith("work-1", "https://files.example/work.zip")

    const submitted = { ...work, status: "SUBMITTED" as const, verificationDetails: { evidence: "https://files.example/work.zip" } }
    rerender(<ConditionManagement conditions={[submitted]} canEdit={false} canRespond role="CLIENT" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    expect(screen.getByText(/Provider submitted work/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("Feedback (required if rejecting)"), { target: { value: "Please add signed report." } })
    fireEvent.click(screen.getByRole("button", { name: "Reject Submission" }))
    expect(review).toHaveBeenCalledWith("work-1", "REJECT", "Please add signed report.")
  })

  it("lets the provider submit evidence and the creator review it", () => {
    const evidence: BackendCondition = {
      id: "evidence-1", escrowId: "escrow-1", title: "Title report", description: "Provide a signed report.",
      type: "EVIDENCE_SUBMITTED", config: { evidenceRequirement: "Signed title report", actorRole: "PAYER" }, required: true,
      status: "PENDING", satisfiedAt: null, satisfiedBy: null, verificationDetails: null, createdAt: 1, updatedAt: 1,
    }
    const submit = vi.fn()
    const review = vi.fn()
    const { rerender } = render(<ConditionManagement conditions={[evidence]} canEdit={false} canRespond role="CLIENT" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    expect(screen.queryByRole("button", { name: "Submit Evidence" })).not.toBeInTheDocument()
    rerender(<ConditionManagement conditions={[evidence]} canEdit={false} canRespond role="PROVIDER" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    fireEvent.change(screen.getByPlaceholderText("Required evidence link or details"), { target: { value: "report.pdf" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit Evidence" }))
    expect(submit).toHaveBeenCalledWith("evidence-1", "report.pdf")
    const submitted = { ...evidence, status: "SUBMITTED" as const, verificationDetails: { evidence: "report.pdf" } }
    rerender(<ConditionManagement conditions={[submitted]} canEdit={false} canRespond role="CLIENT" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onSatisfy={submit} onReviewWork={review} busy={false} />)
    expect(screen.getByRole("button", { name: "Accept Submission" })).toBeInTheDocument()
  })

  it("loads condition-based agreements without requesting milestone records", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith("/api/escrows")
        ? [{ id: "escrow-1", title: "Sale", description: "", clientId: "payer-1", freelancerId: "payee-1", payerId: "payer-1", payeeId: "payee-1", totalAmount: 50, status: "CREATED", releaseModel: "CONDITION_BASED", createdAt: 0, updatedAt: 0 }]
        : url.endsWith("/conditions") ? [] : { eligible: false, reason: "No conditions", conditions: [] }
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const agreements = await api.getAllEscrowsWithReleaseItems()
    expect(agreements[0]).not.toHaveProperty("milestones")
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes("/milestones"))).toBe(false)
  })
})

describe("escrow dispute creation form", () => {
  const baseEscrow = {
    id: "escrow-1", title: "Purchase", description: "Agreement", domain: "Goods",
    providerName: "Provider", clientName: "Client", totalAmount: 100,
    releaseModel: "Milestone Based" as const, state: "CREATED" as const, milestones: [], conditions: [],
    disputes: [], releaseEligible: false, releaseBlockedReason: "Not funded", disputed: false,
    createdAt: "2026-01-01 00:00:00",
  }
  const commonProps = {
    escrow: baseEscrow, role: "CLIENT" as const,
    currentUserId: "payer-1", users: [provider],
    onAction: vi.fn(), onConditionAction: vi.fn(), onConditionCreate: vi.fn(), onConditionUpdate: vi.fn(),
    onConditionDelete: vi.fn(), onConditionSatisfy: vi.fn(), onConditionReviewWork: vi.fn(),
    loadingAction: null, onBack: vi.fn(),
  }

  it("shows only the milestone lifecycle when there is one milestone", () => {
    const milestone = { id: "design", title: "Design", description: "", amount: 100, state: "UNDER_REVIEW" as const, order: 1 }
    render(<EscrowDetailsPage {...commonProps} escrow={{ ...baseEscrow, milestones: [milestone] }} onDisputeCreate={vi.fn()} />)
    const lifecycle = screen.getByRole("list", { name: "Design lifecycle" })
    expect(within(lifecycle).getByText("Under Review").closest("li")).toHaveAttribute("aria-current", "step")
    expect(screen.queryByRole("list", { name: "Milestone checkpoints" })).not.toBeInTheDocument()
    expect(screen.queryByRole("progressbar", { name: "Milestones closed" })).not.toBeInTheDocument()
  })

  it("shows ordered checkpoints and updates progress from each milestone's own state", () => {
    const design = { id: "design", title: "Design", description: "", amount: 100, state: "RELEASED" as const, order: 1 }
    const delivery = { id: "delivery", title: "Delivery", description: "", amount: 100, state: "IN_PROGRESS" as const, order: 2 }
    const onDisputeCreate = vi.fn()
    const { rerender } = render(<EscrowDetailsPage {...commonProps} escrow={{ ...baseEscrow, milestones: [delivery, design] }} onDisputeCreate={onDisputeCreate} />)
    const overview = screen.getByRole("list", { name: "Milestone checkpoints" })
    expect(within(overview).getAllByRole("link").map(link => link.textContent)).toEqual(["Design", "Delivery"])
    expect(within(overview).getByRole("link", { name: "Delivery" })).toHaveAttribute("href", "#milestone-delivery")
    const progress = screen.getByRole("progressbar", { name: "Milestones closed" })
    expect(progress).toHaveAttribute("aria-valuenow", "1")
    expect(progress).toHaveAttribute("aria-valuemax", "2")
    expect(screen.queryByRole("list", { name: "Design lifecycle" })).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Delivery lifecycle" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View more for Design" }))
    expect(within(screen.getByRole("list", { name: "Design lifecycle" })).getByText("Released").closest("li")).toHaveAttribute("aria-current", "step")
    expect(screen.queryByRole("list", { name: "Delivery lifecycle" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View less for Design" }))
    expect(screen.queryByRole("list", { name: "Design lifecycle" })).not.toBeInTheDocument()
    fireEvent.click(within(overview).getByRole("link", { name: "Delivery" }))
    expect(screen.getByRole("button", { name: "View less for Delivery" })).toHaveAttribute("aria-expanded", "true")
    expect(within(screen.getByRole("list", { name: "Delivery lifecycle" })).getByText("In Progress").closest("li")).toHaveAttribute("aria-current", "step")

    rerender(<EscrowDetailsPage {...commonProps} escrow={{ ...baseEscrow, milestones: [{ ...delivery, state: "CANCELLED" }, design] }} onDisputeCreate={onDisputeCreate} />)
    expect(progress).toHaveAttribute("aria-valuenow", "2")
    const cancelledLifecycle = screen.getByRole("list", { name: "Delivery lifecycle" })
    expect(within(cancelledLifecycle).getByText("CANCELLED").closest("li")).toHaveAttribute("aria-current", "step")
    expect(within(cancelledLifecycle).queryByText("Released")).not.toBeInTheDocument()
  })

  it("submits the required dispute details", async () => {
    const createDispute = vi.fn().mockResolvedValue(undefined)
    render(<EscrowDetailsPage {...commonProps} onDisputeCreate={createDispute} />)
    fireEvent.click(screen.getByRole("button", { name: "Raise Dispute" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Missing delivery" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "The order did not arrive." } })
    fireEvent.click(screen.getByRole("button", { name: "Submit Dispute" }))
    await screen.findByRole("button", { name: "Raise Dispute" })
    expect(createDispute).toHaveBeenCalledWith({
      title: "Missing delivery", category: "OTHER", description: "The order did not arrive.", requestedResolution: "OTHER",
    })
  })

  it("does not require or show a milestone for condition-based agreements", () => {
    render(<EscrowDetailsPage {...commonProps} escrow={{ ...baseEscrow, releaseModel: "Condition Based" }} onDisputeCreate={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByRole("list", { name: "Escrow lifecycle" })).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Milestone checkpoints" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Raise Dispute" }))
    expect(screen.queryByLabelText("Related milestone (optional)")).not.toBeInTheDocument()
  })

  it("keeps the milestone lifecycle visible during a dispute while hiding submission actions", () => {
    const milestone = { id: "design", title: "Design", description: "", amount: 100, state: "IN_PROGRESS" as const, order: 1 }
    const escrow = { ...baseEscrow, disputed: true, state: "DISPUTED" as const, milestones: [milestone] }
    render(<EscrowDetailsPage {...commonProps} escrow={escrow} role="PROVIDER" onDisputeCreate={vi.fn()} />)
    expect(screen.getByRole("list", { name: "Design lifecycle" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Choose work files to submit")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit for Review" })).not.toBeInTheDocument()
  })

  it("defaults a milestone-based dispute to a specific milestone instead of the whole escrow", () => {
    const escrow = {
      ...baseEscrow,
      milestones: [
        { id: "milestone-one", title: "First phase", amount: 100, description: "First", state: "FUNDED" as const, order: 1 },
        { id: "milestone-two", title: "Second phase", amount: 100, description: "Second", state: "CREATED" as const, order: 2 },
      ],
    }
    render(<EscrowDetailsPage {...commonProps} escrow={escrow} onDisputeCreate={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByRole("button", { name: "Raise Dispute" }))
    expect(screen.getByLabelText(/Related milestone/)).toHaveValue("milestone-one")
  })

  it("keeps another milestone's provider submission usable after the disputed milestone is refunded", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    const escrow = {
      ...baseEscrow,
      state: "IN_PROGRESS" as const, disputed: false,
      milestones: [
        { id: "milestone-refunded", title: "First phase", amount: 100, description: "Returned after dispute.", state: "CANCELLED" as const, order: 1 },
        { id: "milestone-active", title: "Second phase", amount: 100, description: "Continue the work.", state: "IN_PROGRESS" as const, order: 2 },
      ],
    }
    render(<EscrowDetailsPage {...commonProps} role="PROVIDER" escrow={escrow} onAction={onAction} onDisputeCreate={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByRole("heading", { name: "First phase" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Second phase" })).toBeInTheDocument()
    const file = new File(["phase two work"], "phase-two.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getAllByLabelText("Choose work files to submit")[0], { target: { files: [file] } })
    fireEvent.click(screen.getAllByRole("button", { name: "Submit for Review" })[0])
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("SUBMIT", "milestone-active", expect.objectContaining({ attachments: expect.any(Array) })))
  })
})

describe("dispute evidence panel", () => {
  it("uploads evidence and displays the returned file metadata", async () => {
    const dispute: BackendDispute = {
      id: "dispute-1", escrowId: "escrow-1", milestoneId: null, raisedBy: "payer-1",
      title: "Missing delivery", category: "NON_DELIVERY", reason: "No delivery.",
      requestedResolution: "REFUND_TO_CLIENT", status: "OPEN", resolvedAt: null, createdAt: 1, updatedAt: 1,
    }
    const evidence: BackendDisputeEvidence = {
      id: "evidence-1", disputeId: dispute.id, uploadedBy: "payer-1", type: "PDF", description: "Signed receipt",
      fileName: "receipt.pdf", mimeType: "application/pdf", fileSize: 9, fileHash: "abc123", createdAt: 2,
      downloadUrl: `/api/disputes/${dispute.id}/evidence/evidence-1/file`,
    }
    const list = vi.spyOn(api, "getDisputeEvidence").mockResolvedValue([])
    const upload = vi.spyOn(api, "uploadDisputeEvidence").mockResolvedValue(evidence)
    render(<DisputeEvidencePanel dispute={dispute} role="CLIENT" actorId="payer-1" users={[{ id: "payer-1", name: "Client", type: "CLIENT", createdAt: 0 }]} />)
    await screen.findByText("No evidence submitted yet.")
    const file = new File(["%PDF-1.7"], "receipt.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText(/Attach evidence/), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText(/Description \(optional\)/), { target: { value: "Signed receipt" } })
    fireEvent.click(screen.getByRole("button", { name: "Upload Evidence" }))
    await screen.findByRole("status")
    expect(upload).toHaveBeenCalledWith(dispute.id, file, "Signed receipt")
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open / Download" })).toBeInTheDocument()
    list.mockRestore()
    upload.mockRestore()
  })
})

describe("admin dispute management", () => {
  it("shows a resolution summary and requires final confirmation before execution", async () => {
    const dispute: BackendDispute = {
      id: "dispute-admin", escrowId: "escrow-admin", milestoneId: null, raisedBy: "payer-1",
      title: "Delivery review", category: "QUALITY_ISSUE", reason: "The delivered work needs review.",
      requestedResolution: "OTHER", status: "UNDER_REVIEW", resolvedAt: null, createdAt: 1, updatedAt: 1,
    }
    const escrow = {
      id: "escrow-admin", title: "Website project", description: "", domain: "General", providerName: "Provider",
      clientName: "Client", totalAmount: 100, releaseModel: "Milestone Based" as const,
      state: "DISPUTED" as const, milestones: [], conditions: [], disputes: [dispute], releaseEligible: false,
      releaseBlockedReason: "Disputed", disputed: true, createdAt: "today",
    }
    const transactions = [{ id: "fund-admin", type: "FUND" as const, escrowId: escrow.id, escrowTitle: escrow.title, milestoneId: "", amount: 100, from: "Client", to: "Escrow", fromAccountId: "client-account", toAccountId: "escrow-account", status: "COMPLETED" as const, timestamp: "today" }]
    const history = vi.spyOn(api, "getDisputeStatusHistory").mockResolvedValue([])
    const resolutions = vi.spyOn(api, "getDisputeResolutions").mockResolvedValue([])
    const execute = vi.spyOn(api, "resolveDispute")
      .mockRejectedValueOnce(new api.ApiError("Network interrupted", "NETWORK_ERROR", 0))
      .mockResolvedValue({
      id: "resolution-1", disputeId: dispute.id, resolvedBy: "admin-1", transactionId: "tx-1", transactionIds: ["tx-1"],
      decision: "RELEASE_TO_PROVIDER", reasoning: "Evidence supports this outcome.", executionStatus: "COMPLETED",
      remainingEscrowBalance: 0, createdAt: 2, allocations: [], status: "RESOLVED", transactions: [],
    })
    const confirm = vi.fn(() => false)
    vi.stubGlobal("confirm", confirm)
    render(<AdminDisputeManagement escrows={[escrow]} transactions={transactions} actorId="admin-1" onRefresh={vi.fn().mockResolvedValue(undefined)} onOpenEscrow={vi.fn()} />)
    await screen.findByText(/Available for selected scope:/)
    const resolveButton = screen.getByRole("button", { name: "Review and Confirm Resolution" })
    expect(resolveButton).toBeDisabled()
    expect(screen.getByText("Enter the admin reasoning to continue.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "Evidence supports this outcome." } })
    expect(resolveButton).toBeEnabled()
    expect(screen.getByText(/Provider receives/)).toHaveTextContent("100")
    fireEvent.click(resolveButton)
    expect(confirm).toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(resolveButton)
    await screen.findByText("Network interrupted")
    fireEvent.click(resolveButton)
    await screen.findByText("Resolution executed successfully.")
    expect(execute.mock.calls[0][1].idempotencyKey).toEqual(execute.mock.calls[1][1].idempotencyKey)
    expect(execute).toHaveBeenCalledWith("dispute-admin", expect.objectContaining({ decision: "RELEASE_TO_PROVIDER", reasoning: "Evidence supports this outcome." }))
    history.mockRestore(); resolutions.mockRestore(); execute.mockRestore()
  })

  it("explains that a dispute without completed funding cannot be resolved", async () => {
    const dispute: BackendDispute = {
      id: "unfunded-dispute", escrowId: "unfunded-escrow", milestoneId: null, raisedBy: "payer-1",
      title: "Unfunded dispute", category: "OTHER", reason: "Review needed.",
      requestedResolution: "OTHER", status: "UNDER_REVIEW", resolvedAt: null, createdAt: 1, updatedAt: 1,
    }
    const escrow = {
      id: dispute.escrowId, title: "Unfunded agreement", description: "", domain: "General", providerName: "Provider",
      clientName: "Client", totalAmount: 100, releaseModel: "Milestone Based" as const,
      state: "DISPUTED" as const, milestones: [], conditions: [], disputes: [dispute], releaseEligible: false,
      releaseBlockedReason: "Disputed", disputed: true, createdAt: "today",
    }
    vi.spyOn(api, "getDisputeStatusHistory").mockResolvedValue([])
    vi.spyOn(api, "getDisputeResolutions").mockResolvedValue([])
    render(<AdminDisputeManagement escrows={[escrow]} transactions={[]} actorId="admin-1" onRefresh={vi.fn().mockResolvedValue(undefined)} onOpenEscrow={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText("Reasoning"), { target: { value: "Review completed." } })
    expect(screen.getByText(/no completed funds available to resolve/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review and Confirm Resolution" })).toBeDisabled()
  })

  it("lets the admin send a specific evidence request visible to participants", async () => {
    const dispute: BackendDispute = {
      id: "dispute-request", escrowId: "escrow-request", milestoneId: null, raisedBy: "payer-1",
      title: "Delivery review", category: "QUALITY_ISSUE", reason: "Needs more proof.",
      requestedResolution: "OTHER", status: "UNDER_REVIEW", resolvedAt: null, createdAt: 1, updatedAt: 1,
    }
    const escrow = {
      id: "escrow-request", title: "Delivery agreement", description: "", domain: "General", providerName: "Provider",
      clientName: "Client", totalAmount: 0, releaseModel: "Milestone Based" as const,
      state: "DISPUTED" as const, milestones: [], conditions: [], disputes: [dispute], releaseEligible: false,
      releaseBlockedReason: "Disputed", disputed: true, createdAt: "today",
    }
    const history = vi.spyOn(api, "getDisputeStatusHistory").mockResolvedValue([])
    const resolutions = vi.spyOn(api, "getDisputeResolutions").mockResolvedValue([])
    const change = vi.spyOn(api, "changeDisputeStatus").mockResolvedValue({} as never)
    render(<AdminDisputeManagement escrows={[escrow]} transactions={[]} actorId="admin-1" onRefresh={vi.fn().mockResolvedValue(undefined)} onOpenEscrow={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/Evidence requested from Client and Provider/), { target: { value: "Please upload a signed delivery receipt dated on the delivery day." } })
    fireEvent.click(screen.getByRole("button", { name: "Send Evidence Request" }))
    await screen.findByRole("status")
    expect(change).toHaveBeenCalledWith(dispute.id, "EVIDENCE_SUBMISSION", "Please upload a signed delivery receipt dated on the delivery day.")
    history.mockRestore(); resolutions.mockRestore(); change.mockRestore()
  })

  it("shows the admin's evidence request to the Client or Provider", async () => {
    const dispute: BackendDispute = {
      id: "dispute-visible", escrowId: "escrow-visible", milestoneId: null, raisedBy: "payer-1",
      title: "Delivery review", category: "QUALITY_ISSUE", reason: "Needs more proof.",
      requestedResolution: "OTHER", status: "EVIDENCE_SUBMISSION", resolvedAt: null, createdAt: 1, updatedAt: 1,
    }
    vi.spyOn(api, "getDisputeStatusHistory").mockResolvedValue([{
      id: "history-request", disputeId: dispute.id, changedBy: "admin-1", fromStatus: "UNDER_REVIEW",
      toStatus: "EVIDENCE_SUBMISSION", reason: "Please upload a signed delivery receipt.", eventType: "STATUS_TRANSITION", createdAt: 2,
    }])
    vi.spyOn(api, "getDisputeResolutions").mockResolvedValue([])
    render(<DisputeActivityPanel dispute={dispute} actorId="payer-1" />)
    expect(await screen.findByText("Please upload a signed delivery receipt.")).toBeInTheDocument()
    expect(screen.getByText(/Admin update.*EVIDENCE SUBMISSION/)).toBeInTheDocument()
  })
})
