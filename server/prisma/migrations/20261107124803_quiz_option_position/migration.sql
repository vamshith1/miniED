-- DropIndex
DROP INDEX "Option_questionId_idx";

-- DropIndex
DROP INDEX "QuizAttempt_quizId_score_idx";

-- AlterTable
ALTER TABLE "Option" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Option_questionId_position_idx" ON "Option"("questionId", "position");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_status_score_idx" ON "QuizAttempt"("quizId", "status", "score" DESC);
