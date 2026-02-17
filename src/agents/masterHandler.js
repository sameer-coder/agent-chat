import { chat, chatStream } from './openaiService.js';
import { createSubAgentAlpha, createSubAgentBeta, getCommunicationBus } from './subAgent.js';

// System prompt for Master Handler
const MASTER_HANDLER_SYSTEM_PROMPT = `You are the Master Handler - the central orchestrator of a multi-agent system.

Your role:
1. Analyze incoming tasks from the user
2. Break down complex tasks into smaller, manageable subtasks
3. Assign appropriate subtasks to your Sub-Agents (Alpha and Beta)
4. Coordinate communication between Sub-Agents when needed
5. Monitor progress and results from Sub-Agents
6. Synthesize the outputs from both Sub-Agents into a coherent final response
7. Answer questions from Sub-Agents when they need clarification about the original
   task, overall goals, constraints, or high-level decisions

Task Analysis Guidelines:
- Identify if the task can be broken into independent subtasks
- Determine which subtasks can run in parallel
- Assign related subtasks to different agents for efficiency
- Consider each agent's strengths when assigning tasks

Communication Style:
- Be clear and professional when directing agents
- Acknowledge when agents report back
- Keep the user informed of progress
- Provide context when assigning subtasks
- When a Sub-Agent asks you a question, answer concisely and helpfully
  based on the original user task and any context you have

Quality Evaluation:
- After receiving results from Sub-Agents, critically evaluate their quality
- Check for completeness, accuracy, depth, and relevance to the original task
- If the results are lacking, assign targeted follow-up tasks to address the gaps
- You may request up to 2 rounds of follow-up work before final synthesis

Final Synthesis:
- Combine results from ALL rounds (initial + any follow-ups) from both Sub-Agents
- Ensure the final response is coherent and complete
- Address any conflicts or gaps in the results
- Present a unified solution to the user

Remember: You are the leader - coordinate, don't do all the work yourself!`;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry with exponential backoff
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateRetryDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Execute a function with retry logic
 * @param {Function} fn - Async function to execute
 * @param {string} operationName - Name of the operation for logging
 * @param {Function} onRetry - Callback for retry events
 * @returns {Promise<{success: boolean, result?: any, error?: string, attempts: number}>}
 */
export async function withRetry(fn, operationName, onRetry = null) {
  let lastError = null;
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { success: true, result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.message?.includes('401') || 
          error.message?.includes('403') ||
          error.message?.includes('Invalid API key')) {
        break;
      }
      
      // If this wasn't the last attempt, wait and retry
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delay = calculateRetryDelay(attempt);
        
        if (onRetry) {
          onRetry({
            operation: operationName,
            attempt: attempt + 1,
            maxRetries: RETRY_CONFIG.maxRetries,
            delay,
            error: error.message
          });
        }
        
        await sleep(delay);
      }
    }
  }
  
  return { 
    success: false, 
    error: lastError?.message || 'Unknown error', 
    attempts: RETRY_CONFIG.maxRetries 
  };
}

/**
 * Master Handler - orchestrates the multi-agent system
 */
export class MasterHandler {
  constructor() {
    this.name = 'Master Handler';
    this.agentId = 'master-handler';
    this.subAgentAlpha = createSubAgentAlpha();
    this.subAgentBeta = createSubAgentBeta();
    this.conversationHistory = [
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT }
    ];
    this.subTasks = {
      alpha: null,
      beta: null
    };
    this.subTaskResults = {
      alpha: null,
      beta: null
    };
    this.executionLog = [];

    // Register master handler on the communication bus so sub-agents can ask it questions
    getCommunicationBus().registerAgent('master-handler', this);
  }

  /**
   * Receive a question from a sub-agent and answer it based on the original task context.
   * @param {string} fromAgentId - The sender's agent ID
   * @param {string} question - The question text
   * @returns {Promise<string>} Answer to the question
   */
  async receiveQuestion(fromAgentId, question) {
    const fromName = fromAgentId === 'sub-agent-alpha' ? 'Sub-Agent Alpha'
      : fromAgentId === 'sub-agent-beta' ? 'Sub-Agent Beta'
      : fromAgentId;

    this.log('question_received', { from: fromAgentId, question });

    // Build a focused prompt so the master can answer using its full context
    const answerPrompt = `${fromName} is asking you a question while working on their subtask:\n\n"${question}"\n\nAnswer the question helpfully and concisely based on the original user task and the context you have. Do NOT re-assign tasks or break down work — just answer the question.`;

    try {
      const response = await chat([
        ...this.conversationHistory,
        { role: 'user', content: answerPrompt }
      ]);

      this.log('question_answered', { from: fromAgentId, answerLength: response.length });

      return response;
    } catch (error) {
      this.log('question_answer_failed', { from: fromAgentId, error: error.message });
      return `I couldn't process your question due to an error: ${error.message}. Please proceed with your best judgment.`;
    }
  }

  /**
   * Receive a general message from another agent (implements the communication bus interface).
   * @param {string} fromAgentId - The sender's agent ID
   * @param {string} message - The message content
   * @returns {Promise<string>} Response
   */
  async receiveMessage(fromAgentId, message) {
    // Delegate to receiveQuestion for simplicity
    return this.receiveQuestion(fromAgentId, message);
  }

  /**
   * Log an execution event
   * @param {string} event - Event type
   * @param {Object} data - Event data
   */
  log(event, data = {}) {
    this.executionLog.push({
      timestamp: new Date().toISOString(),
      event,
      ...data
    });
  }

  /**
   * Process a user task - analyze, break down, and coordinate sub-agents
   * @param {string} task - The user's task
   * @param {Function} onMessage - Callback for streaming messages to the dashboard
   * @returns {Promise<string>} Final synthesized response
   */
  async processTask(task, onMessage = null) {
    // Clear previous execution log
    this.executionLog = [];
    this.log('task_started', { task });

    // Add user task to history
    this.conversationHistory.push({
      role: 'user',
      content: `User's task: "${task}"`
    });

    // Step 1: Analyze task and determine how to break it down
    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'master-handler',
        message: 'Analyzing task and determining how to break it down...'
      });
    }

    // Analyze task with retry
    const analysisResult = await withRetry(
      () => this.analyzeTask(task),
      'task_analysis',
      (retryInfo) => {
        this.log('retry', retryInfo);
        if (onMessage) {
          onMessage({
            type: 'retry',
            agent: 'master-handler',
            message: `Retrying task analysis (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`,
            ...retryInfo
          });
        }
      }
    );

    if (!analysisResult.success) {
      this.log('task_analysis_failed', { error: analysisResult.error });
      throw new Error(`Task analysis failed after ${analysisResult.attempts} attempts: ${analysisResult.error}`);
    }

    const taskAnalysis = analysisResult.result;
    this.log('task_analyzed', { explanation: taskAnalysis.explanation });
    
    if (onMessage) {
      onMessage({
        type: 'task-breakdown',
        agent: 'master-handler',
        message: taskAnalysis.explanation,
        subtasks: taskAnalysis.subtasks
      });
    }

    // Step 2: Assign subtasks to sub-agents
    const subtasks = taskAnalysis.subtasks;
    this.subTasks.alpha = subtasks[0];
    this.subTasks.beta = subtasks[1];

    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'master-handler',
        message: `Assigning subtasks to Sub-Agents...`
      });
    }

    // Update master status to waiting
    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'master-handler',
        message: 'Waiting for Sub-Agents to complete...'
      });
    }

    // Process both subtasks in parallel with error recovery
    const results = await this.processSubTasksWithRecovery(subtasks, onMessage);

    // Handle partial failures
    const { alphaResult, betaResult, partialFailure } = results;
    this.subTaskResults.alpha = alphaResult;
    this.subTaskResults.beta = betaResult;

    // Log sub-agent results to dashboard (Round 1)
    if (onMessage) {
      if (alphaResult) {
        onMessage({
          type: 'agent-result',
          agent: 'alpha',
          message: alphaResult,
          round: 1
        });
      }
      if (betaResult) {
        onMessage({
          type: 'agent-result',
          agent: 'beta',
          message: betaResult,
          round: 1
        });
      }
    }

    if (partialFailure) {
      this.log('partial_failure', { 
        alphaSuccess: !!alphaResult, 
        betaSuccess: !!betaResult 
      });
      
      if (onMessage) {
        onMessage({
          type: 'warning',
          agent: 'master-handler',
          message: 'One or more sub-agents encountered issues. Proceeding with available results.'
        });
      }
    }

    // ── Step 3: Evaluation & Follow-up Loop ──
    const MAX_FOLLOW_UP_ROUNDS = 2;
    const allResults = {
      alpha: [alphaResult],
      beta: [betaResult]
    };

    for (let round = 1; round <= MAX_FOLLOW_UP_ROUNDS; round++) {
      if (onMessage) {
        onMessage({
          type: 'status',
          agent: 'master-handler',
          message: `Evaluating sub-agent results (round ${round})...`
        });
      }

      const latestAlpha = allResults.alpha[allResults.alpha.length - 1];
      const latestBeta = allResults.beta[allResults.beta.length - 1];

      const evaluation = await this.evaluateResults(task, latestAlpha, latestBeta);
      this.log('evaluation', { round, satisfied: evaluation.satisfied });

      if (onMessage) {
        onMessage({
          type: 'evaluation',
          agent: 'master-handler',
          message: evaluation.reasoning,
          satisfied: evaluation.satisfied,
          round
        });
      }

      if (evaluation.satisfied) {
        this.log('evaluation_satisfied', { round });
        break;
      }

      // Assign follow-up tasks
      if (onMessage) {
        onMessage({
          type: 'status',
          agent: 'master-handler',
          message: `Assigning follow-up tasks (round ${round})...`
        });
      }

      const followUpPromises = [];

      if (evaluation.followUps.alpha) {
        this.log('follow_up_assigned', { agent: 'alpha', round, task: evaluation.followUps.alpha });
        if (onMessage) {
          onMessage({
            type: 'follow-up-assignment',
            agent: 'master-handler',
            target: 'alpha',
            message: evaluation.followUps.alpha,
            round: round + 1
          });
        }
        followUpPromises.push(
          this.processFollowUpTask('alpha', evaluation.followUps.alpha, onMessage)
            .then(r => ({ agent: 'alpha', result: r }))
            .catch(e => ({ agent: 'alpha', result: `[Follow-up failed: ${e.message}]` }))
        );
      }

      if (evaluation.followUps.beta) {
        this.log('follow_up_assigned', { agent: 'beta', round, task: evaluation.followUps.beta });
        if (onMessage) {
          onMessage({
            type: 'follow-up-assignment',
            agent: 'master-handler',
            target: 'beta',
            message: evaluation.followUps.beta,
            round: round + 1
          });
        }
        followUpPromises.push(
          this.processFollowUpTask('beta', evaluation.followUps.beta, onMessage)
            .then(r => ({ agent: 'beta', result: r }))
            .catch(e => ({ agent: 'beta', result: `[Follow-up failed: ${e.message}]` }))
        );
      }

      if (followUpPromises.length === 0) break;

      const followUpResults = await Promise.all(followUpPromises);

      for (const { agent, result } of followUpResults) {
        allResults[agent].push(result);
        if (onMessage) {
          onMessage({
            type: 'agent-result',
            agent,
            message: result,
            round: round + 1
          });
        }
      }
    }

    // ── Step 4: Synthesize all results ──
    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'master-handler',
        message: 'Synthesizing all results from Sub-Agents...'
      });
    }

    // Synthesize with retry
    const synthesisResult = await withRetry(
      () => this.synthesizeResults(task, allResults),
      'result_synthesis',
      (retryInfo) => {
        this.log('retry', retryInfo);
        if (onMessage) {
          onMessage({
            type: 'retry',
            agent: 'master-handler',
            message: `Retrying result synthesis (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`,
            ...retryInfo
          });
        }
      }
    );

    if (!synthesisResult.success) {
      this.log('synthesis_failed', { error: synthesisResult.error });
      throw new Error(`Result synthesis failed after ${synthesisResult.attempts} attempts: ${synthesisResult.error}`);
    }

    const synthesis = synthesisResult.result;

    // Add final response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: synthesis
    });

    this.log('task_completed', { synthesisLength: synthesis.length });

    if (onMessage) {
      onMessage({
        type: 'complete',
        agent: 'master-handler',
        message: synthesis
      });
    }

    return synthesis;
  }

  /**
   * Process subtasks with error recovery and partial failure handling
   * @param {Array<string>} subtasks - Array of two subtasks
   * @param {Function} onMessage - Callback for messages
   * @returns {Promise<Object>} Results object with alpha and beta results
   */
  async processSubTasksWithRecovery(subtasks, onMessage = null) {
    // Create communication callback for inter-agent messaging
    const onCommunication = (commEvent) => {
      this.log('inter_agent_communication', commEvent);
      if (onMessage) {
        onMessage(commEvent);
      }
    };

    // Process both subtasks in parallel with individual retry logic
    const [alphaResult, betaResult] = await Promise.allSettled([
      this.processSubTaskAlpha(subtasks[0], onMessage, onCommunication),
      this.processSubTaskBeta(subtasks[1], onMessage, onCommunication)
    ]);

    // Handle results with graceful degradation
    let alphaValue = null;
    let betaValue = null;
    let partialFailure = false;

    if (alphaResult.status === 'fulfilled') {
      alphaValue = alphaResult.value;
    } else {
      this.log('subtask_alpha_failed', { error: alphaResult.reason?.message });
      alphaValue = `[Sub-Agent Alpha failed: ${alphaResult.reason?.message || 'Unknown error'}]`;
      partialFailure = true;
    }

    if (betaResult.status === 'fulfilled') {
      betaValue = betaResult.value;
    } else {
      this.log('subtask_beta_failed', { error: betaResult.reason?.message });
      betaValue = `[Sub-Agent Beta failed: ${betaResult.reason?.message || 'Unknown error'}]`;
      partialFailure = true;
    }

    // If both failed, throw an error
    if (alphaResult.status === 'rejected' && betaResult.status === 'rejected') {
      throw new Error(
        `Both sub-agents failed. Alpha: ${alphaResult.reason?.message}. Beta: ${betaResult.reason?.message}`
      );
    }

    return {
      alphaResult: alphaValue,
      betaResult: betaValue,
      partialFailure
    };
  }

  /**
   * Analyze the task and determine how to break it down
   * @param {string} task - The task to analyze
   * @returns {Promise<Object>} Analysis result with subtasks
   */
  async analyzeTask(task) {
    const analysisPrompt = `Analyze this task and break it down into exactly 2 independent subtasks that can be worked on in parallel by different agents.

IMPORTANT: The two subtasks MUST be DIFFERENT from each other. Each subtask should cover a distinct aspect of the overall task.

Task: "${task}"

You MUST provide your response in this EXACT format (do not deviate):
EXPLANATION: [Brief explanation of how you're breaking down the task]
SUBTASK 1: [First subtask for Sub-Agent Alpha - a specific, distinct portion of the work]
SUBTASK 2: [Second subtask for Sub-Agent Beta - a different, complementary portion of the work]`;

    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: analysisPrompt }
    ]);

    // Parse the response - try structured format first
    let explanation = '';
    const subtasks = ['', ''];
    
    // Try primary parsing: look for EXPLANATION:, SUBTASK 1:, SUBTASK 2: markers
    const lines = response.split('\n');
    let currentField = '';
    for (const line of lines) {
      const stripped = line.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '').trim();
      if (/^EXPLANATION\s*:/i.test(stripped)) {
        currentField = 'explanation';
        explanation = stripped.replace(/^EXPLANATION\s*:/i, '').trim();
      } else if (/^SUBTASK\s*1\s*:/i.test(stripped)) {
        currentField = 'subtask1';
        subtasks[0] = stripped.replace(/^SUBTASK\s*1\s*:/i, '').trim();
      } else if (/^SUBTASK\s*2\s*:/i.test(stripped)) {
        currentField = 'subtask2';
        subtasks[1] = stripped.replace(/^SUBTASK\s*2\s*:/i, '').trim();
      } else if (currentField === 'explanation' && stripped) {
        explanation += ' ' + stripped;
      } else if (currentField === 'subtask1' && stripped && !/^SUBTASK/i.test(stripped)) {
        subtasks[0] += ' ' + stripped;
      } else if (currentField === 'subtask2' && stripped) {
        subtasks[1] += ' ' + stripped;
      }
    }

    // Fallback: if parsing produced empty/identical subtasks, try alternate patterns
    if (!subtasks[0] || !subtasks[1] || subtasks[0] === subtasks[1]) {
      // Try numbered list: "1. ..." / "2. ..."
      const numbered = response.match(/(?:^|\n)\s*1[\.\):]\s*(.+?)(?=\n\s*2[\.\):])/s);
      const numbered2 = response.match(/(?:^|\n)\s*2[\.\):]\s*(.+?)(?=\n\s*(?:3[\.\):]|$))/s);
      if (numbered && numbered2) {
        subtasks[0] = numbered[1].trim().split('\n')[0].trim();
        subtasks[1] = numbered2[1].trim().split('\n')[0].trim();
      }
    }

    // Safety: if subtasks are still empty, use generic halves
    if (!subtasks[0]) subtasks[0] = `First half of the task: ${task}`;
    if (!subtasks[1]) subtasks[1] = `Second half of the task: ${task}`;
    if (!explanation) explanation = 'Breaking the task into two complementary subtasks.';

    // Final guard: if somehow both subtasks are identical, differentiate them
    if (subtasks[0].trim() === subtasks[1].trim()) {
      subtasks[0] = `Research and analyze the first aspect of: ${task}`;
      subtasks[1] = `Research and analyze the second/complementary aspect of: ${task}`;
    }

    return {
      explanation: explanation.trim(),
      subtasks: subtasks.map(s => s.trim())
    };
  }

  /**
   * Process subtask for Alpha agent with retry logic
   */
  async processSubTaskAlpha(subtask, onMessage, onCommunication = null) {
    if (onMessage) {
      onMessage({
        type: 'task-assignment',
        agent: 'master-handler',
        target: 'alpha',
        message: `Assigning to Sub-Agent Alpha: "${subtask}"`
      });
    }

    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'alpha',
        message: 'Processing subtask...'
      });
    }

    // Process with retry
    const result = await withRetry(
      () => this.subAgentAlpha.processSubtask(subtask, () => {}, onCommunication),
      'subtask_alpha',
      (retryInfo) => {
        this.log('retry', { ...retryInfo, agent: 'alpha' });
        if (onMessage) {
          onMessage({
            type: 'retry',
            agent: 'alpha',
            message: `Retrying subtask (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`,
            ...retryInfo
          });
        }
      }
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    console.log(`\n===== SUB-AGENT ALPHA RESULT (${result.result?.length || 0} chars) =====`);
    console.log(result.result?.substring(0, 300) + (result.result?.length > 300 ? '...' : ''));
    console.log('===== END ALPHA RESULT =====\n');

    if (onMessage) {
      onMessage({
        type: 'task-complete',
        agent: 'alpha',
        message: 'Subtask completed'
      });
    }

    return result.result;
  }

  /**
   * Process subtask for Beta agent with retry logic
   */
  async processSubTaskBeta(subtask, onMessage, onCommunication = null) {
    if (onMessage) {
      onMessage({
        type: 'task-assignment',
        agent: 'master-handler',
        target: 'beta',
        message: `Assigning to Sub-Agent Beta: "${subtask}"`
      });
    }

    if (onMessage) {
      onMessage({
        type: 'status',
        agent: 'beta',
        message: 'Processing subtask...'
      });
    }

    // Process with retry
    const result = await withRetry(
      () => this.subAgentBeta.processSubtask(subtask, () => {}, onCommunication),
      'subtask_beta',
      (retryInfo) => {
        this.log('retry', { ...retryInfo, agent: 'beta' });
        if (onMessage) {
          onMessage({
            type: 'retry',
            agent: 'beta',
            message: `Retrying subtask (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`,
            ...retryInfo
          });
        }
      }
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    console.log(`\n===== SUB-AGENT BETA RESULT (${result.result?.length || 0} chars) =====`);
    console.log(result.result?.substring(0, 300) + (result.result?.length > 300 ? '...' : ''));
    console.log('===== END BETA RESULT =====\n');

    if (onMessage) {
      onMessage({
        type: 'task-complete',
        agent: 'beta',
        message: 'Subtask completed'
      });
    }

    return result.result;
  }

  /**
   * Synthesize results from both sub-agents across all rounds
   * @param {string} originalTask - The original task
   * @param {Object} allResults - { alpha: string[], beta: string[] } results from all rounds
   * @returns {Promise<string>} Synthesized response
   */
  async synthesizeResults(originalTask, allResults) {
    // Build per-agent result blocks that include all rounds
    const formatAgentResults = (agentName, results) => {
      if (results.length === 1) {
        return `${agentName} produced this output:\n--- ${agentName.toUpperCase()} OUTPUT ---\n${results[0]}\n--- END ---`;
      }
      return results.map((r, i) => {
        const label = i === 0 ? 'Initial task' : `Follow-up round ${i}`;
        return `${agentName} — ${label}:\n--- ${agentName.toUpperCase()} ROUND ${i + 1} ---\n${r}\n--- END ---`;
      }).join('\n\n');
    };

    const alphaBlock = formatAgentResults('Sub-Agent Alpha', allResults.alpha);
    const betaBlock = formatAgentResults('Sub-Agent Beta', allResults.beta);
    const totalRounds = Math.max(allResults.alpha.length, allResults.beta.length);
    const roundsNote = totalRounds > 1
      ? `\n\nNote: The sub-agents completed ${totalRounds} round(s) of work (initial + ${totalRounds - 1} follow-up(s)). Incorporate findings from ALL rounds.`
      : '';

    const synthesisPrompt = `You are the Master Handler synthesizing results from your two Sub-Agents.

The user originally requested: "${originalTask}"

${alphaBlock}

${betaBlock}
${roundsNote}

IMPORTANT: The outputs above ARE the completed results from the sub-agents. Do NOT say you haven't received them. Synthesize these results into a coherent, complete final response for the user. Combine the findings from all rounds, address any overlaps or conflicts, and present a unified solution.`;

    // Use a CLEAN messages array — do NOT pass conversationHistory here.
    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: synthesisPrompt }
    ]);

    return response;
  }

  /**
   * Evaluate sub-agent results and decide whether follow-up tasks are needed
   * @param {string} originalTask - The original user task
   * @param {string} alphaResult - Latest result from Alpha
   * @param {string} betaResult - Latest result from Beta
   * @returns {Promise<{satisfied: boolean, reasoning: string, followUps: {alpha: string|null, beta: string|null}}>}
   */
  async evaluateResults(originalTask, alphaResult, betaResult) {
    const evaluationPrompt = `You are the Master Handler evaluating your Sub-Agents' work.

Original user task: "${originalTask}"

Sub-Agent Alpha's latest output:
--- ALPHA ---
${alphaResult || '[No output]'}
--- END ALPHA ---

Sub-Agent Beta's latest output:
--- BETA ---
${betaResult || '[No output]'}
--- END BETA ---

Critically evaluate whether these results TOGETHER adequately address the user's task.
Consider: completeness, depth, accuracy, relevance, and whether anything important is missing.

You MUST respond in this EXACT format:

VERDICT: SATISFIED or NEEDS_FOLLOW_UP
REASONING: [Brief explanation of your evaluation]
FOLLOW_UP_ALPHA: [Follow-up task for Alpha, or NONE if Alpha's work is adequate]
FOLLOW_UP_BETA: [Follow-up task for Beta, or NONE if Beta's work is adequate]

Only request follow-ups for genuinely important gaps. Minor stylistic issues do not warrant follow-ups.`;

    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: evaluationPrompt }
    ]);

    // Parse the evaluation response
    let satisfied = true;
    let reasoning = '';
    const followUps = { alpha: null, beta: null };

    const lines = response.split('\n');
    let currentField = '';
    for (const line of lines) {
      const stripped = line.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '').trim();
      if (/^VERDICT\s*:/i.test(stripped)) {
        const verdict = stripped.replace(/^VERDICT\s*:/i, '').trim().toUpperCase();
        satisfied = !verdict.includes('NEEDS_FOLLOW_UP') && !verdict.includes('FOLLOW');
        currentField = 'verdict';
      } else if (/^REASONING\s*:/i.test(stripped)) {
        currentField = 'reasoning';
        reasoning = stripped.replace(/^REASONING\s*:/i, '').trim();
      } else if (/^FOLLOW_UP_ALPHA\s*:/i.test(stripped)) {
        currentField = 'alpha';
        const val = stripped.replace(/^FOLLOW_UP_ALPHA\s*:/i, '').trim();
        if (val && !/^NONE$/i.test(val) && !/^N\/A$/i.test(val)) {
          followUps.alpha = val;
        }
      } else if (/^FOLLOW_UP_BETA\s*:/i.test(stripped)) {
        currentField = 'beta';
        const val = stripped.replace(/^FOLLOW_UP_BETA\s*:/i, '').trim();
        if (val && !/^NONE$/i.test(val) && !/^N\/A$/i.test(val)) {
          followUps.beta = val;
        }
      } else if (stripped && currentField === 'reasoning') {
        reasoning += ' ' + stripped;
      } else if (stripped && currentField === 'alpha' && followUps.alpha) {
        followUps.alpha += ' ' + stripped;
      } else if (stripped && currentField === 'beta' && followUps.beta) {
        followUps.beta += ' ' + stripped;
      }
    }

    // If verdict says needs follow-up but no specific tasks were parsed, mark as satisfied
    if (!satisfied && !followUps.alpha && !followUps.beta) {
      satisfied = true;
      reasoning += ' (No specific follow-up tasks identified, proceeding with current results.)';
    }

    if (!reasoning) reasoning = satisfied ? 'Results are satisfactory.' : 'Results need improvement.';

    console.log(`\n===== EVALUATION: ${satisfied ? 'SATISFIED' : 'NEEDS FOLLOW-UP'} =====`);
    console.log(`Reasoning: ${reasoning}`);
    if (followUps.alpha) console.log(`Follow-up Alpha: ${followUps.alpha}`);
    if (followUps.beta) console.log(`Follow-up Beta: ${followUps.beta}`);
    console.log('===== END EVALUATION =====\n');

    return { satisfied, reasoning, followUps };
  }

  /**
   * Process a follow-up task for a specific sub-agent
   * @param {'alpha'|'beta'} agent - Which agent to assign the follow-up to
   * @param {string} followUpTask - The follow-up task description
   * @param {Function} onMessage - Dashboard callback
   * @returns {Promise<string>} The follow-up result
   */
  async processFollowUpTask(agent, followUpTask, onMessage = null) {
    const subAgent = agent === 'alpha' ? this.subAgentAlpha : this.subAgentBeta;
    const agentLabel = agent === 'alpha' ? 'Alpha' : 'Beta';

    if (onMessage) {
      onMessage({
        type: 'status',
        agent,
        message: `Processing follow-up task...`
      });
    }

    const onCommunication = (commEvent) => {
      this.log('inter_agent_communication', commEvent);
      if (onMessage) onMessage(commEvent);
    };

    const result = await withRetry(
      () => subAgent.processSubtask(followUpTask, () => {}, onCommunication),
      `follow_up_${agent}`,
      (retryInfo) => {
        this.log('retry', { ...retryInfo, agent });
        if (onMessage) {
          onMessage({
            type: 'retry',
            agent,
            message: `Retrying follow-up (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`,
            ...retryInfo
          });
        }
      }
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    console.log(`\n===== SUB-AGENT ${agentLabel} FOLLOW-UP RESULT (${result.result?.length || 0} chars) =====`);
    console.log(result.result?.substring(0, 300) + (result.result?.length > 300 ? '...' : ''));
    console.log(`===== END ${agentLabel} FOLLOW-UP =====\n`);

    if (onMessage) {
      onMessage({
        type: 'task-complete',
        agent,
        message: 'Follow-up completed'
      });
    }

    return result.result;
  }

  /**
   * Get the execution log
   * @returns {Array} Execution log entries
   */
  getExecutionLog() {
    return [...this.executionLog];
  }

  /**
   * Reset the Master Handler for a new task
   */
  reset() {
    this.conversationHistory = [
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT }
    ];
    this.subAgentAlpha.reset();
    this.subAgentBeta.reset();
    this.subTasks = { alpha: null, beta: null };
    this.subTaskResults = { alpha: null, beta: null };
    this.executionLog = [];
    
    // Clear communication bus history
    const bus = getCommunicationBus();
    bus.clearHistory();
    // Re-register master handler
    bus.registerAgent('master-handler', this);
  }
}

/**
 * Create a new Master Handler instance
 */
export function createMasterHandler() {
  return new MasterHandler();
}

export default {
  MasterHandler,
  createMasterHandler,
  withRetry,
  RETRY_CONFIG
};
