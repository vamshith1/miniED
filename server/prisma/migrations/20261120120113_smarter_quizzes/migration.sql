-- CreateEnum
CREATE TYPE "QuizMode" AS ENUM ('TEST', 'PRACTICE');

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "skill" TEXT;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "mode" "QuizMode" NOT NULL DEFAULT 'TEST',
ADD COLUMN     "negativePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passPercent" INTEGER;

-- AlterTable
ALTER TABLE "QuizAttempt" ALTER COLUMN "score" SET DEFAULT 0,
ALTER COLUMN "score" SET DATA TYPE DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PracticeRun" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "wrong" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "timeTakenMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "PracticeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PracticeRun_studentId_createdAt_idx" ON "PracticeRun"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeRun_quizId_studentId_idx" ON "PracticeRun"("quizId", "studentId");

-- AddForeignKey
ALTER TABLE "PracticeRun" ADD CONSTRAINT "PracticeRun_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRun" ADD CONSTRAINT "PracticeRun_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
