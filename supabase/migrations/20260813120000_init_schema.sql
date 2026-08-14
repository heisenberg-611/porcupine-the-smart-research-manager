-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('THESIS', 'SYSTEMATIC_REVIEW', 'LAB_PAPER', 'GENERAL');

-- CreateEnum
CREATE TYPE "OwnershipModel" AS ENUM ('STUDENT_OWNED', 'LAB_OWNED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'ORG');

-- CreateEnum
CREATE TYPE "AccessRole" AS ENUM ('OWNER', 'ADMIN', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "FunctionRole" AS ENUM ('CONCEPTUALIZATION', 'METHODOLOGY', 'INVESTIGATION', 'DATA_CURATION', 'FORMAL_ANALYSIS', 'WRITING_ORIGINAL', 'WRITING_REVIEW', 'VISUALIZATION', 'SUPERVISION', 'PROJECT_ADMIN');

-- CreateEnum
CREATE TYPE "HistoryAccess" AS ENUM ('ALL_HISTORY', 'FROM_JOIN');

-- CreateEnum
CREATE TYPE "DigestCadence" AS ENUM ('NONE', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "orcid" TEXT,
    "affiliation" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "identity_pub_key" BYTEA,
    "signing_pub_key" BYTEA,
    "wrapped_bundle" BYTEA,
    "kdf_salt" BYTEA,
    "key_bundle_ver" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "device_pub_key" BYTEA NOT NULL,
    "wrapped_master_key" BYTEA NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sso_provider" TEXT,
    "domain" TEXT,
    "retention_days" INTEGER,
    "escrow_enabled" BOOLEAN NOT NULL DEFAULT false,
    "escrow_pub_key" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id","user_id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProjectKind" NOT NULL DEFAULT 'THESIS',
    "ownership_model" "OwnershipModel" NOT NULL DEFAULT 'STUDENT_OWNED',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "assist_enabled" BOOLEAN NOT NULL DEFAULT false,
    "current_key_epoch" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_role" "AccessRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "function_roles" "FunctionRole"[],
    "invited_by" UUID,
    "joined_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "history_access" "HistoryAccess" NOT NULL DEFAULT 'ALL_HISTORY',
    "history_from" TIMESTAMPTZ(3),
    "digest_cadence" "DigestCadence" NOT NULL DEFAULT 'DAILY',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_keys" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "epoch" INTEGER NOT NULL,
    "wrapped_key" BYTEA NOT NULL,
    "wrapped_by" UUID NOT NULL,
    "signature" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_orcid_key" ON "users"("orcid");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "org_members_user_id_idx" ON "org_members"("user_id");

-- CreateIndex
CREATE INDEX "projects_created_by_idx" ON "projects"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_slug_key" ON "projects"("org_id", "slug");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_keys_user_id_idx" ON "project_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_keys_project_id_user_id_epoch_key" ON "project_keys"("project_id", "user_id", "epoch");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_keys" ADD CONSTRAINT "project_keys_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_keys" ADD CONSTRAINT "project_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

