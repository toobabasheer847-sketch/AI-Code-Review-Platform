-- Adds a decline outcome without rewriting existing invitation rows.
ALTER TYPE "WorkspaceInvitationStatus" ADD VALUE 'DECLINED';
