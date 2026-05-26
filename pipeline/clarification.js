/**
 * Clarification System
 * Detects vague, conflicting, or underspecified prompts and either:
 *   a) Returns clarification questions (low confidence)
 *   b) Makes reasonable assumptions (medium confidence) and documents them
 *   c) Proceeds normally (high confidence)
 */

import { callClaude } from '../utils/claude_client.js';
import { safeParseJSON } from '../utils/json_utils.js';

const CONFIDENCE_THRESHOLD = 0.55;

const CLARIFICATION_SYSTEM_PROMPT = `You are an expert at analyzing software requirements.
Analyze the given app description and return ONLY valid JSON with this exact shape:
{
  "confidence": 0.0 to 1.0,
  "issues": ["list of specific problems"],
  "conflictingRequirements": ["list of contradictions found"],
  "missingCritical": ["list of critical missing info"],
  "assumptions": ["list of reasonable assumptions you can make"],
  "clarificationQuestions": ["list of clear yes/no or short-answer questions"],
  "sanitizedPrompt": "the prompt with ambiguities resolved using assumptions"
}

Confidence guide:
- 0.0-0.3: Too vague to build anything meaningful
- 0.3-0.55: Buildable with major assumptions
- 0.55-0.8: Clear intent, minor gaps
- 0.8-1.0: Complete and unambiguous

No markdown. No explanation. JSON only.`;

export async function analyzePromptConfidence(userPrompt) {
  // Fast local checks first (no API needed)
  const localResult = quickAnalyze(userPrompt);

// Return immediately if local analysis found conflicts
if (
    localResult.conflictingRequirements?.length > 0
) {
    return localResult;
}

// Return immediately for very low confidence prompts
if (
    localResult.confidence < 0.15
) {
    return localResult;
}

  // Use Claude for deeper analysis
  try {
    const response = await callClaude({
      system: CLARIFICATION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Analyze this app description:\n"${userPrompt}"`
      }],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const result = safeParseJSON(response, 'Clarification');
    return normalizeClarificationResult(result, userPrompt);
  } catch {
    return localResult;
  }
}

function quickAnalyze(prompt) {
  const trimmed = prompt.trim();
  const wordCount = trimmed.split(/\s+/).length;

  // Too short
  if (wordCount < 5) {
    return {
      confidence: 0.1,
      issues: ['Prompt too short to infer app requirements'],
      conflictingRequirements: [],
      missingCritical: ['app purpose', 'core features', 'target users'],
      assumptions: [],
      clarificationQuestions: [
        'What is the main purpose of this app?',
        'Who will use this app?',
        'What are the 3 most important features?',
      ],
      sanitizedPrompt: prompt,
      needsClarification: true,
    };
  }

  // Detect obvious conflicts
  const conflicts = detectConflicts(trimmed);

  // Detect very vague language
  const vaguePatterns = [/^build (an?|the) app$/i, /^make something/i, /^create (an?|the) (website|app|thing)$/i];
  const isVague = vaguePatterns.some(p => p.test(trimmed));

  if (isVague) {
    return {
      confidence: 0.2,
      issues: ['Prompt lacks specifics about features, users, or purpose'],
      conflictingRequirements: conflicts,
      missingCritical: ['specific features', 'user roles', 'core entities'],
      assumptions: ['Assuming a generic web application', 'Assuming user authentication needed'],
      clarificationQuestions: [
        'What domain is this app for? (e.g. CRM, e-commerce, healthcare)',
        'Who are the primary users?',
        'What are the 3 core features?',
      ],
      sanitizedPrompt: prompt,
      needsClarification: true,
    };
  }

  // Reasonable prompt
  return {
    confidence: 0.7,
    issues: [],
    conflictingRequirements: conflicts,
    missingCritical: [],
    assumptions: conflicts.length > 0 ? ['Treating conflicting requirements as separate feature tiers'] : [],
    clarificationQuestions: conflicts.length > 0 ? [
      'Please clarify the conflicting requirements listed',
    ] : [],
    sanitizedPrompt: prompt,
    needsClarification: conflicts.length > 0,
  };
}

function detectConflicts(prompt) {
  const conflicts = [];
  const lower = prompt.toLowerCase();

  const wantsFree =
    /\bfree\b/.test(lower);

const wantsPaid =
    /\bpaid\b|\bpremium\b|\bsubscription\b|\bpayment\b/.test(lower);

if (wantsFree && wantsPaid) {
    conflicts.push(
      'Contradictory: both free and paid/premium requirements mentioned'
    );
}
  if (lower.includes('public') && lower.includes('private') && lower.includes('data')) {
    conflicts.push('Contradictory: both "public" and "private" data access mentioned');
  }
  if (lower.includes('no login') && (lower.includes('user account') || lower.includes('authentication'))) {
    conflicts.push('Contradictory: "no login" but user accounts or authentication mentioned');
  }
  if (lower.includes('admin') && lower.includes('cannot') && lower.includes('admin')) {
    conflicts.push('Possible contradiction in admin permissions');
  }

  return conflicts;
}

function normalizeClarificationResult(result, originalPrompt) {
  const confidence = typeof result.confidence === 'number'
    ? Math.max(0, Math.min(1, result.confidence)) : 0.5;

  return {
    confidence,
    issues: Array.isArray(result.issues) ? result.issues : [],
    conflictingRequirements: Array.isArray(result.conflictingRequirements) ? result.conflictingRequirements : [],
    missingCritical: Array.isArray(result.missingCritical) ? result.missingCritical : [],
    assumptions: Array.isArray(result.assumptions) ? result.assumptions : [],
    clarificationQuestions: Array.isArray(result.clarificationQuestions) ? result.clarificationQuestions : [],
    sanitizedPrompt: result.sanitizedPrompt || originalPrompt,
    needsClarification:
    (confidence < CONFIDENCE_THRESHOLD)
    &&
    (
        result.conflictingRequirements.length > 0 ||
        result.questions.length > 0
    ),
  };
}

export { CONFIDENCE_THRESHOLD };
