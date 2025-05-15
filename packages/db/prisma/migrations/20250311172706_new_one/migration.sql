/*
  Warnings:

  - You are about to drop the column `about` on the `Channel` table. All the data in the column will be lost.
  - Added the required column `description` to the `Channel` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Channel" DROP COLUMN "about",
ADD COLUMN     "botUsername" TEXT,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "hasBot" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "telegramId" SET DATA TYPE TEXT;
