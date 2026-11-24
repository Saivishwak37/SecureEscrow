-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'PROVIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('CREATED', 'FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'RELEASED', 'CANCELLED', 'DISPUTED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReleaseModel" AS ENUM ('MILESTONE_BASED', 'CONDITION_BASED');

-- CreateEnum
CREATE TYPE "ReleasePolicy" AS ENUM ('ALL_REQUIRED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PERSONAL', 'ESCROW', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ConditionType" AS ENUM ('CLIENT_APPROVAL', 'WORK_SUBMITTED', 'DEADLINE_REACHED', 'PARTICIPANT_APPROVAL', 'EVIDENCE_SUBMITTED', 'DELIVERY_CONFIRMED', 'EXTERNAL_VERIFICATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ConditionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'REJECTED', 'SATISFIED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('FUND', 'RELEASE', 'REFUND', 'DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'EVIDENCE_SUBMISSION', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('PDF', 'JPEG', 'PNG');

-- CreateEnum
CREATE TYPE "ResolutionDecision" AS ENUM ('RELEASE_TO_PROVIDER', 'REFUND_TO_CLIENT', 'SPLIT_FUNDS', 'PARTIAL_RELEASE');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HistoryEvent" AS ENUM ('STATUS_TRANSITION', 'RESOLUTION_EXECUTED', 'RESOLUTION_FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "name" TEXT,
    "password_hash" TEXT,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "total_amount" DECIMAL(30,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "LifecycleStatus" NOT NULL DEFAULT 'CREATED',
    "status_before_dispute" "LifecycleStatus",
    "release_model" "ReleaseModel" NOT NULL,
    "release_policy" "ReleasePolicy" NOT NULL DEFAULT 'ALL_REQUIRED',
    "agreement_type" TEXT NOT NULL DEFAULT 'GENERAL',
    "terms" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_participant" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "escrow_id" TEXT,
    "type" "AccountType" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(30,8) NOT NULL,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'CREATED',
    "order" INTEGER NOT NULL,
    "review_feedback" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_submission" (
    "id" TEXT NOT NULL,
    "milestone_id" TEXT NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "attachments" JSONB NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_condition" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "ConditionType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConditionStatus" NOT NULL DEFAULT 'PENDING',
    "satisfied_at" TIMESTAMPTZ(3),
    "satisfied_by" TEXT,
    "satisfied_by_system" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by" TEXT,
    "verification_details" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT,
    "milestone_id" TEXT,
    "resolution_id" TEXT,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(30,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "idempotency_key" TEXT,
    "request_shape" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "amount" DECIMAL(30,8) NOT NULL,
    "balance" DECIMAL(30,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "milestone_id" TEXT,
    "raised_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_resolution" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_message" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_resolution" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "resolved_by" TEXT NOT NULL,
    "decision" "ResolutionDecision" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_shape" TEXT NOT NULL,
    "execution_status" "ResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "remaining_escrow_balance" DECIMAL(30,8),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_resolution_allocation" (
    "id" TEXT NOT NULL,
    "resolution_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "recipient_account_id" TEXT NOT NULL,
    "amount" DECIMAL(30,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_resolution_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_status_history" (
    "id" TEXT NOT NULL,
    "escrow_id" TEXT NOT NULL,
    "changed_by" TEXT,
    "from_status" "LifecycleStatus",
    "to_status" "LifecycleStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_status_history" (
    "id" TEXT NOT NULL,
    "milestone_id" TEXT NOT NULL,
    "changed_by" TEXT,
    "from_status" "LifecycleStatus",
    "to_status" "LifecycleStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_status_history" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "from_status" "DisputeStatus",
    "to_status" "DisputeStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "event_type" "HistoryEvent" NOT NULL,
    "resolution_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "escrow_client_id_created_at_idx" ON "escrow"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "escrow_provider_id_created_at_idx" ON "escrow"("provider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_id_currency_key" ON "escrow"("id", "currency");

-- CreateIndex
CREATE INDEX "escrow_participant_user_id_idx" ON "escrow_participant"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_participant_escrow_id_user_id_role_key" ON "escrow_participant"("escrow_id", "user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "account_escrow_id_key" ON "account"("escrow_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_id_currency_key" ON "account"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "account_user_id_currency_key" ON "account"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "account_escrow_id_currency_key" ON "account"("escrow_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_escrow_id_order_key" ON "milestone"("escrow_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_id_escrow_id_key" ON "milestone"("id", "escrow_id");

-- CreateIndex
CREATE INDEX "milestone_submission_milestone_id_submitted_at_idx" ON "milestone_submission"("milestone_id", "submitted_at");

-- CreateIndex
CREATE INDEX "escrow_condition_escrow_id_created_at_idx" ON "escrow_condition"("escrow_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_idempotency_key_key" ON "transaction"("idempotency_key");

-- CreateIndex
CREATE INDEX "transaction_escrow_id_created_at_idx" ON "transaction"("escrow_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_milestone_id_created_at_idx" ON "transaction"("milestone_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_from_account_id_created_at_idx" ON "transaction"("from_account_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_to_account_id_created_at_idx" ON "transaction"("to_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_id_currency_key" ON "transaction"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_id_resolution_id_to_account_id_currency_key" ON "transaction"("id", "resolution_id", "to_account_id", "currency");

-- CreateIndex
CREATE INDEX "ledger_entry_account_id_created_at_idx" ON "ledger_entry"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_transaction_id_type_key" ON "ledger_entry"("transaction_id", "type");

-- CreateIndex
CREATE INDEX "dispute_escrow_id_created_at_idx" ON "dispute"("escrow_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_evidence_storage_key_key" ON "dispute_evidence"("storage_key");

-- CreateIndex
CREATE INDEX "dispute_evidence_dispute_id_created_at_idx" ON "dispute_evidence"("dispute_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_message_dispute_id_created_at_idx" ON "dispute_message"("dispute_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_resolution_dispute_id_created_at_idx" ON "dispute_resolution"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_resolution_dispute_id_idempotency_key_key" ON "dispute_resolution"("dispute_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_resolution_id_dispute_id_key" ON "dispute_resolution"("id", "dispute_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_resolution_allocation_transaction_id_key" ON "dispute_resolution_allocation"("transaction_id");

-- CreateIndex
CREATE INDEX "dispute_resolution_allocation_resolution_id_idx" ON "dispute_resolution_allocation"("resolution_id");

-- CreateIndex
CREATE INDEX "escrow_status_history_escrow_id_created_at_idx" ON "escrow_status_history"("escrow_id", "created_at");

-- CreateIndex
CREATE INDEX "milestone_status_history_milestone_id_created_at_idx" ON "milestone_status_history"("milestone_id", "created_at");

-- CreateIndex
CREATE INDEX "dispute_status_history_dispute_id_created_at_idx" ON "dispute_status_history"("dispute_id", "created_at");

-- AddForeignKey
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow" ADD CONSTRAINT "escrow_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_participant" ADD CONSTRAINT "escrow_participant_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_participant" ADD CONSTRAINT "escrow_participant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_escrow_id_currency_fkey" FOREIGN KEY ("escrow_id", "currency") REFERENCES "escrow"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_submission" ADD CONSTRAINT "milestone_submission_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_submission" ADD CONSTRAINT "milestone_submission_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_submission" ADD CONSTRAINT "milestone_submission_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_condition" ADD CONSTRAINT "escrow_condition_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_condition" ADD CONSTRAINT "escrow_condition_satisfied_by_fkey" FOREIGN KEY ("satisfied_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_condition" ADD CONSTRAINT "escrow_condition_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_escrow_id_currency_fkey" FOREIGN KEY ("escrow_id", "currency") REFERENCES "escrow"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_milestone_id_escrow_id_fkey" FOREIGN KEY ("milestone_id", "escrow_id") REFERENCES "milestone"("id", "escrow_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "dispute_resolution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_from_account_id_currency_fkey" FOREIGN KEY ("from_account_id", "currency") REFERENCES "account"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_to_account_id_currency_fkey" FOREIGN KEY ("to_account_id", "currency") REFERENCES "account"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transaction_id_currency_fkey" FOREIGN KEY ("transaction_id", "currency") REFERENCES "transaction"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_currency_fkey" FOREIGN KEY ("account_id", "currency") REFERENCES "account"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_milestone_id_escrow_id_fkey" FOREIGN KEY ("milestone_id", "escrow_id") REFERENCES "milestone"("id", "escrow_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_message" ADD CONSTRAINT "dispute_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_resolution" ADD CONSTRAINT "dispute_resolution_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_resolution" ADD CONSTRAINT "dispute_resolution_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_resolution_allocation" ADD CONSTRAINT "dispute_resolution_allocation_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "dispute_resolution"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_resolution_allocation" ADD CONSTRAINT "dispute_resolution_allocation_transaction_id_resolution_id_fkey" FOREIGN KEY ("transaction_id", "resolution_id", "recipient_account_id", "currency") REFERENCES "transaction"("id", "resolution_id", "to_account_id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_status_history" ADD CONSTRAINT "escrow_status_history_escrow_id_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "escrow_status_history" ADD CONSTRAINT "escrow_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_status_history" ADD CONSTRAINT "milestone_status_history_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_status_history" ADD CONSTRAINT "milestone_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_status_history" ADD CONSTRAINT "dispute_status_history_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "dispute"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_status_history" ADD CONSTRAINT "dispute_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dispute_status_history" ADD CONSTRAINT "dispute_status_history_resolution_id_dispute_id_fkey" FOREIGN KEY ("resolution_id", "dispute_id") REFERENCES "dispute_resolution"("id", "dispute_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
