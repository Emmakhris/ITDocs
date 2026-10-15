-- CreateEnum
CREATE TYPE "VaultAccessLevel" AS ENUM ('VIEW', 'EDIT');

-- CreateTable
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultFolderAccess" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "role" "Role",
    "userId" TEXT,
    "level" "VaultAccessLevel" NOT NULL DEFAULT 'VIEW',

    CONSTRAINT "VaultFolderAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "url" TEXT,
    "notes" TEXT,
    "secretEnc" TEXT NOT NULL,
    "totpEnc" TEXT,
    "rotateEveryDays" INTEGER,
    "rotationDueAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialHistory" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedBy" TEXT NOT NULL,

    CONSTRAINT "CredentialHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultFolderAccess_folderId_role_key" ON "VaultFolderAccess"("folderId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "VaultFolderAccess_folderId_userId_key" ON "VaultFolderAccess"("folderId", "userId");

-- CreateIndex
CREATE INDEX "Credential_folderId_idx" ON "Credential"("folderId");

-- CreateIndex
CREATE INDEX "Credential_rotationDueAt_idx" ON "Credential"("rotationDueAt");

-- CreateIndex
CREATE INDEX "Credential_title_idx" ON "Credential"("title");

-- CreateIndex
CREATE INDEX "CredentialHistory_credentialId_replacedAt_idx" ON "CredentialHistory"("credentialId", "replacedAt");

-- AddForeignKey
ALTER TABLE "VaultFolderAccess" ADD CONSTRAINT "VaultFolderAccess_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolderAccess" ADD CONSTRAINT "VaultFolderAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialHistory" ADD CONSTRAINT "CredentialHistory_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
