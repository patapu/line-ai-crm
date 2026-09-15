-- CHECK constraints the Prisma schema cannot express (see docs/design.md section 2).
ALTER TABLE "Lead" ADD CONSTRAINT lead_score_range CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100);
ALTER TABLE "Lead" ADD CONSTRAINT lead_value_nonneg CHECK ("value" IS NULL OR "value" >= 0);
ALTER TABLE "Lead" ADD CONSTRAINT lead_lost_needs_reason CHECK ("stage" <> 'LOST' OR "lostReason" IS NOT NULL);
ALTER TABLE "AiSuggestion" ADD CONSTRAINT ai_score_range CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "Message" ADD CONSTRAINT outbound_line_has_retry_key
  CHECK (NOT ("direction" = 'OUTBOUND' AND "channel" = 'LINE') OR "retryKey" IS NOT NULL);
