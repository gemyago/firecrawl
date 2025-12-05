import { generateObject } from "ai";
import * as Sentry from "@sentry/node";
import { logger } from "../logger";
import { BrandingEnhancement, brandingEnhancementSchema } from "./schema";
import { buildBrandingPrompt } from "./prompt";
import { BrandingLLMInput } from "./types";
import { getModel } from "../generic-ai";

export async function enhanceBrandingWithLLM(
  input: BrandingLLMInput,
): Promise<BrandingEnhancement> {
  const prompt = buildBrandingPrompt(input);

  // Smart model selection: use more powerful model for complex cases
  // gpt-4o-mini: cheaper, good for simple cases
  // gpt-4o: more capable, better for complex prompts with many buttons/logos
  const buttonsCount = input.buttons?.length || 0;
  const logoCandidatesCount = input.logoCandidates?.length || 0;
  const promptLength = prompt.length;

  // Use gpt-4o for complex cases:
  // - Many buttons (>8)
  // - Many logo candidates (>5)
  // - Long prompt (>8000 chars)
  // - Has screenshot (adds complexity)
  const isComplexCase =
    buttonsCount > 8 ||
    logoCandidatesCount > 5 ||
    promptLength > 8000 ||
    !!input.screenshot;

  const modelName = isComplexCase ? "gpt-4o" : "gpt-4o-mini";
  const model = getModel(modelName);

  try {
    const result = await generateObject({
      model,
      schema: brandingEnhancementSchema,
      messages: [
        {
          role: "system",
          content:
            "You are a brand design expert analyzing websites to extract accurate branding information.",
        },
        {
          role: "user",
          content: input.screenshot
            ? [
                { type: "text", text: prompt },
                { type: "image", image: input.screenshot },
              ]
            : prompt,
        },
      ],
      temperature: 0.1,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "enhanceBrandingWithLLM",
        metadata: {
          teamId: input.teamId || "unknown",
        },
      },
    });

    return result.object;
  } catch (error) {
    Sentry.captureException(error);

    logger.error("LLM branding enhancement failed", {
      error,
      buttonsCount: input.buttons?.length || 0,
      promptLength: prompt.length,
    });

    return {
      cleanedFonts: [],
      buttonClassification: {
        primaryButtonIndex: -1,
        primaryButtonReasoning: "LLM failed",
        secondaryButtonIndex: -1,
        secondaryButtonReasoning: "LLM failed",
        confidence: 0,
      },
      colorRoles: {
        confidence: 0,
      },
    };
  }
}
