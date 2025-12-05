import { logger } from "../logger";

interface LogoCandidate {
  src: string;
  alt: string;
  isSvg: boolean;
  isVisible: boolean;
  location: "header" | "body" | "footer";
  position: { top: number; left: number; width: number; height: number };
  indicators: {
    inHeader: boolean;
    altMatch: boolean;
    srcMatch: boolean;
    classMatch: boolean;
    hrefMatch: boolean;
  };
  href?: string;
  source: string;
}

interface LogoSelectionResult {
  selectedIndex: number;
  confidence: number;
  method: "heuristic" | "llm" | "fallback";
  reasoning: string;
}

/**
 * Detect logo variants - returns groups of similar logos
 */
function detectLogoVariants(
  candidates: LogoCandidate[],
): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  const processed = new Set<number>();

  candidates.forEach((candidate, index) => {
    if (processed.has(index)) return;

    const similarIndices = [index];
    processed.add(index);

    // Find similar logos
    candidates.forEach((other, otherIndex) => {
      if (index === otherIndex || processed.has(otherIndex)) return;

      // Check if they're variants of the same logo
      const isSimilar =
        // Same or very similar alt text (case insensitive)
        (candidate.alt &&
          other.alt &&
          candidate.alt.toLowerCase().replace(/\s+/g, "") ===
            other.alt.toLowerCase().replace(/\s+/g, "")) ||
        // Same src (exact match or only differs by size/theme)
        candidate.src === other.src ||
        (candidate.src.includes(other.src.split("?")[0].split("/").pop()!) &&
          candidate.src.split("?")[0].split("/").pop() ===
            other.src.split("?")[0].split("/").pop()) ||
        // Both have similar positioning and size (likely same logo, different themes)
        (Math.abs(candidate.position.top - other.position.top) < 20 &&
          Math.abs(candidate.position.left - other.position.left) < 50 &&
          Math.abs(candidate.position.width - other.position.width) < 30);

      if (isSimilar) {
        similarIndices.push(otherIndex);
        processed.add(otherIndex);
      }
    });

    if (similarIndices.length > 0) {
      groups.set(index, similarIndices);
    }
  });

  return groups;
}

/**
 * Pick the best variant from a group of similar logos
 */
function pickBestVariant(
  candidates: LogoCandidate[],
  variantIndices: number[],
): number {
  // Prefer: 1) Visible, 2) In header, 3) Highest position (top), 4) Has href
  return variantIndices.reduce((best, current) => {
    const bestCandidate = candidates[best];
    const currentCandidate = candidates[current];

    // Visible beats non-visible
    if (currentCandidate.isVisible && !bestCandidate.isVisible) return current;
    if (!currentCandidate.isVisible && bestCandidate.isVisible) return best;

    // Header location beats others
    if (
      currentCandidate.indicators.inHeader &&
      !bestCandidate.indicators.inHeader
    )
      return current;
    if (
      !currentCandidate.indicators.inHeader &&
      bestCandidate.indicators.inHeader
    )
      return best;

    // Higher position (smaller top value) wins
    if (currentCandidate.position.top < bestCandidate.position.top)
      return current;
    if (currentCandidate.position.top > bestCandidate.position.top) return best;

    // Has href to homepage
    if (
      currentCandidate.indicators.hrefMatch &&
      !bestCandidate.indicators.hrefMatch
    )
      return current;

    return best;
  });
}

/**
 * Detect if a logo appears in multiple locations (strong brand indicator)
 */
function detectRepeatedLogos(candidates: LogoCandidate[]): Set<number> {
  const repeated = new Set<number>();
  const srcGroups = new Map<string, number[]>();

  // Group by similar src
  candidates.forEach((candidate, index) => {
    const srcKey =
      candidate.src.split("?")[0].split("/").pop()?.toLowerCase() ||
      candidate.src;
    if (!srcGroups.has(srcKey)) {
      srcGroups.set(srcKey, []);
    }
    srcGroups.get(srcKey)!.push(index);
  });

  // If a logo appears in different locations (header + footer), it's likely the brand logo
  srcGroups.forEach(indices => {
    if (indices.length > 1) {
      const locations = new Set(indices.map(i => candidates[i].location));
      if (locations.size > 1) {
        // Appears in multiple locations - strong brand indicator
        indices.forEach(i => repeated.add(i));
      }
    }
  });

  return repeated;
}

/**
 * Smart logo selection with tiered approach:
 * 1. Strong heuristics (fast, free) - handles 70-80% of cases
 * 2. LLM validation (slow, expensive) - only when ambiguous
 * 3. Fallback to best guess
 */
export function selectLogoWithConfidence(
  candidates: LogoCandidate[],
  brandName?: string,
): LogoSelectionResult {
  if (candidates.length === 0) {
    return {
      selectedIndex: -1,
      confidence: 0,
      method: "fallback",
      reasoning: "No logo candidates provided",
    };
  }

  // STEP 1: Detect logo variants and pick best from each group
  const variantGroups = detectLogoVariants(candidates);
  const repeatedLogos = detectRepeatedLogos(candidates);

  logger.debug("Logo variant analysis", {
    totalCandidates: candidates.length,
    variantGroupsCount: variantGroups.size,
    repeatedLogosCount: repeatedLogos.size,
  });

  // If we have variants, score only the best from each group
  const indicesToScore = new Set<number>();
  const variantBonuses = new Map<number, number>();

  if (variantGroups.size > 0) {
    variantGroups.forEach(variants => {
      const bestIndex = pickBestVariant(candidates, variants);
      indicesToScore.add(bestIndex);

      // Bonus: if this logo appears in multiple locations (repeated)
      if (variants.some(i => repeatedLogos.has(i))) {
        variantBonuses.set(bestIndex, 15); // +15 for appearing multiple times
      }
      // Bonus: having multiple variants suggests it's important
      if (variants.length > 1) {
        variantBonuses.set(bestIndex, (variantBonuses.get(bestIndex) || 0) + 8);
      }
    });
  } else {
    // No variants detected, score all
    candidates.forEach((_, index) => indicesToScore.add(index));
  }

  // STEP 2: Score each candidate (or representative from each variant group)
  const scored = candidates.map((candidate, index) => {
    // Skip if not in scoring list (it's a worse variant)
    if (!indicesToScore.has(index)) {
      return {
        index,
        score: -999,
        candidate,
        reasons: "skipped (duplicate variant)",
      };
    }

    let score = 0;
    const reasons: string[] = [];

    // Add variant bonuses first
    const variantBonus = variantBonuses.get(index) || 0;
    if (variantBonus > 0) {
      score += variantBonus;
      reasons.push(`variant bonus (+${variantBonus})`);
    }

    // VERY STRONG indicators
    if (candidate.indicators.hrefMatch && candidate.indicators.inHeader) {
      score += 50; // Logo in header linking to homepage = almost certainly the brand logo
      reasons.push("header logo linking to homepage");
    } else if (candidate.indicators.hrefMatch) {
      score += 35; // Links to homepage
      reasons.push("links to homepage");
    } else if (candidate.indicators.inHeader) {
      score += 25; // In header/nav
      reasons.push("in header");
    }

    // Penalty for no link at all - brand logos are usually clickable
    if (!candidate.href || candidate.href.trim() === "") {
      score -= 15;
      reasons.push("no link (brand logos usually link to homepage, penalty)");
    }

    // STRONG indicators
    if (candidate.location === "header") {
      score += 20;
      reasons.push("header location");
    }

    if (candidate.isVisible) {
      score += 15;
      reasons.push("visible");
    }

    // Position - prefer top-left (typical logo position)
    if (candidate.position.top < 100 && candidate.position.left < 300) {
      score += 10;
      reasons.push("top-left position");
    }

    // Extra bonus for being the HIGHEST logo (smallest top value)
    const isHighest = candidates.every(
      (other, otherIndex) =>
        otherIndex === index || candidate.position.top <= other.position.top,
    );
    if (isHighest && candidate.position.top < 200) {
      score += 12;
      reasons.push("highest logo on page");
    }

    // MODERATE indicators
    if (candidate.indicators.altMatch) {
      score += 8;
      reasons.push("alt matches logo/brand");
    }

    if (candidate.indicators.srcMatch) {
      score += 5;
      reasons.push("src contains logo");
    }

    if (candidate.indicators.classMatch) {
      score += 5;
      reasons.push("class contains logo");
    }

    // Brand name match in alt text (if brand name provided)
    if (brandName) {
      const altLower = candidate.alt.toLowerCase().trim();
      const brandLower = brandName.toLowerCase().trim();

      if (altLower === brandLower) {
        // Exact match - very strong indicator
        score += 20;
        reasons.push(`alt exactly matches brand name "${brandName}"`);
      } else if (
        altLower.includes(brandLower) ||
        brandLower.includes(altLower)
      ) {
        // Partial match
        score += 12;
        reasons.push(`alt contains brand name "${brandName}"`);
      }

      // Also check src for brand name
      if (candidate.src.toLowerCase().includes(brandLower)) {
        score += 6;
        reasons.push(`src contains brand name "${brandName}"`);
      }
    }

    // Size considerations - not too small, not too large
    const area = candidate.position.width * candidate.position.height;
    const width = candidate.position.width;
    const height = candidate.position.height;

    if (area > 1000 && area < 50000) {
      score += 5;
      reasons.push("reasonable size");
    } else if (area < 500) {
      // Very small - likely an icon, not a logo
      score -= 8;
      reasons.push("too small (likely icon, penalty)");
    } else if (area > 100000) {
      // Very large - likely a banner, hero image, or og:image
      score -= 10;
      reasons.push("too large (likely banner/og:image, penalty)");
    } else if (area > 200000) {
      // Extremely large - definitely not a logo (og:images are typically 1200x630 = 756,000px²)
      score -= 20;
      reasons.push("extremely large (likely og:image, heavy penalty)");
    }

    // Additional penalty for square icons that are very small (typical UI icons)
    // UI icons are often 16x16, 20x20, 24x24, 32x32
    const isSquare = Math.abs(width - height) < 5;
    if (isSquare && (width < 40 || height < 40)) {
      score -= 12;
      reasons.push("small square icon (likely UI icon, heavy penalty)");
    }

    // SVGs are often logos (but not always)
    if (candidate.isSvg) {
      score += 3;
      reasons.push("SVG format");
    }

    // Penalties
    if (candidate.location === "footer") {
      score -= 15;
      reasons.push("footer location (penalty)");
    }

    if (candidate.location === "body" && !candidate.indicators.inHeader) {
      score -= 10;
      reasons.push("body location without header (penalty)");
    }

    if (!candidate.isVisible) {
      score -= 10;
      reasons.push("not visible (penalty)");
    }

    return {
      index,
      score,
      candidate,
      reasons: reasons.join(", "),
    };
  });

  // Filter out skipped variants and sort by score
  const validScored = scored.filter(s => s.score > -900);
  validScored.sort((a, b) => b.score - a.score);

  if (validScored.length === 0) {
    return {
      selectedIndex: -1,
      confidence: 0,
      method: "fallback",
      reasoning: "All candidates were filtered out as duplicate variants",
    };
  }

  const top = validScored[0];
  const secondBest = validScored[1];

  // Calculate confidence based on score and separation from second place
  const scoreSeparation = secondBest ? top.score - secondBest.score : top.score;

  // Decision logic:
  // 1. STRONG confidence: top score >= 60 AND well separated from second (20+ points)
  if (top.score >= 60 && scoreSeparation >= 20) {
    return {
      selectedIndex: top.index,
      confidence: 0.9,
      method: "heuristic",
      reasoning: `Strong indicators: ${top.reasons}. Score: ${top.score} (clear winner by ${scoreSeparation} points)`,
    };
  }

  // 2. GOOD confidence: top score >= 45 AND reasonably separated (15+ points)
  if (top.score >= 45 && scoreSeparation >= 15) {
    return {
      selectedIndex: top.index,
      confidence: 0.75,
      method: "heuristic",
      reasoning: `Good indicators: ${top.reasons}. Score: ${top.score} (ahead by ${scoreSeparation} points)`,
    };
  }

  // 3. MODERATE confidence: top score >= 30
  if (top.score >= 30) {
    return {
      selectedIndex: top.index,
      confidence: 0.6,
      method: "heuristic",
      reasoning: `Moderate indicators: ${top.reasons}. Score: ${top.score}. May benefit from LLM validation.`,
    };
  }

  // 4. LOW confidence: ambiguous case - needs LLM
  // Return top candidate but signal that LLM should validate
  return {
    selectedIndex: top.index,
    confidence: 0.4,
    method: "heuristic",
    reasoning: `Weak indicators: ${top.reasons}. Score: ${top.score}. LLM validation recommended (close scores: top=${top.score}, second=${secondBest?.score || 0})`,
  };
}

/**
 * Determine if LLM validation is needed based on heuristic confidence
 */
export function shouldUseLLMForLogoSelection(confidence: number): boolean {
  // Always use LLM for logo validation to ensure quality
  // Only skip LLM for extremely high confidence cases (> 0.85)
  return confidence < 0.85;
}

/**
 * Get top N candidates for LLM validation (when needed)
 * Returns the highest-scoring candidates to reduce token usage
 */
export function getTopCandidatesForLLM(
  candidates: LogoCandidate[],
  maxCandidates: number = 10,
): { filteredCandidates: LogoCandidate[]; indexMap: Map<number, number> } {
  if (candidates.length <= maxCandidates) {
    // Return all candidates with identity mapping
    const indexMap = new Map<number, number>();
    candidates.forEach((_, i) => indexMap.set(i, i));
    return { filteredCandidates: candidates, indexMap };
  }

  // Score each candidate
  const scored = candidates.map((candidate, originalIndex) => {
    let score = 0;

    // Strong indicators
    if (candidate.indicators.hrefMatch && candidate.indicators.inHeader)
      score += 50;
    else if (candidate.indicators.hrefMatch) score += 35;
    else if (candidate.indicators.inHeader) score += 25;

    // Location
    if (candidate.location === "header") score += 20;

    // Visibility
    if (candidate.isVisible) score += 15;

    // Class/src/alt matches
    if (candidate.indicators.classMatch) score += 10;
    if (candidate.indicators.srcMatch) score += 10;
    if (candidate.indicators.altMatch) score += 5;

    return { originalIndex, score, candidate };
  });

  // Sort by score (highest first) and take top N
  scored.sort((a, b) => b.score - a.score);
  const topScored = scored.slice(0, maxCandidates);

  // Create index map: new index -> original index
  const indexMap = new Map<number, number>();
  topScored.forEach((item, newIndex) => {
    indexMap.set(newIndex, item.originalIndex);
  });

  const filteredCandidates = topScored.map(s => s.candidate);

  return { filteredCandidates, indexMap };
}
