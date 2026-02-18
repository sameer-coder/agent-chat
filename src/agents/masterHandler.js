import { chat, chatStream } from './openaiService.js';
import { createSubAgent, getCommunicationBus, MAX_SUB_AGENTS } from './subAgent.js';

const MASTER_HANDLER_SYSTEM_PROMPT = `You are the Master Handler - the central orchestrator of a multi-agent system.

Your role:
1. Analyze incoming tasks from the user
2. Determine how many specialized Agents are needed (between 1 and 5) based on task complexity
3. Break down complex tasks into independent subtasks for each Agent
4. Assign appropriate subtasks to your Agents
5. Coordinate communication between Agents when needed
6. Monitor progress and results from Agents
7. Synthesize the outputs from all Agents into a coherent final response
8. Answer questions from Agents when they need clarification

Task Analysis Guidelines:
- Simple tasks may only need 1-2 agents
- Moderately complex tasks may need 2-3 agents
- Highly complex tasks with many independent components may need 4-5 agents
- Each subtask should be meaningfully different from the others
- Consider what can run in parallel
- Never spawn more agents than there are meaningful subtasks

Communication Style:
- Be clear and professional when directing agents
- Acknowledge when agents report back
- Keep the user informed of progress
- When an Agent asks you a question, answer concisely and helpfully

Quality Evaluation:
- After receiving results, critically evaluate their quality
- Check for completeness, accuracy, depth, and relevance
- If results are lacking, assign targeted follow-up tasks
- You may request up to 2 rounds of follow-up work before final synthesis

Final Synthesis:
- Combine results from ALL rounds from all Agents
- Ensure the final response is coherent and complete
- Address any conflicts or gaps in the results
- Present a unified solution to the user

Remember: You are the leader - coordinate, don't do all the work yourself!`;

export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateRetryDelay(attempt) {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

export async function withRetry(fn, operationName, onRetry = null) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { success: true, result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (error.message?.includes('401') || error.message?.includes('403') || error.message?.includes('Invalid API key')) {
        break;
      }
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delay = calculateRetryDelay(attempt);
        if (onRetry) {
          onRetry({ operation: operationName, attempt: attempt + 1, maxRetries: RETRY_CONFIG.maxRetries, delay, error: error.message });
        }
        await sleep(delay);
      }
    }
  }
  return { success: false, error: lastError?.message || 'Unknown error', attempts: RETRY_CONFIG.maxRetries };
}

const AGENT_NAMES = {
  0: 'Nova',
  1: 'Cipher',
  2: 'Atlas',
  3: 'Nexus',
  4: 'Prism'
};

function getAgentNames(count) {
  const names = {};
  for (let i = 0; i < count; i++) {
    names[i] = AGENT_NAMES[i];
  }
  return names;
}

export class MasterHandler {
  constructor() {
    this.name = 'Master Handler';
    this.agentId = 'master-handler';
    this.agentNames = {};
    this.subAgents = [];
    this.agentCount = 0;
    this.conversationHistory = [
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT }
    ];
    this.subTasks = {};
    this.subTaskResults = {};
    this.executionLog = [];

    getCommunicationBus().registerAgent('master-handler', this);
  }

  /**
   * Spawn N sub-agents and wire them up with display names and sibling references.
   */
  _spawnAgents(count) {
    // Clean up any previously registered sub-agents
    const bus = getCommunicationBus();
    for (const agent of this.subAgents) {
      bus.unregisterAgent(agent.agentId);
    }

    this.agentCount = count;
    this.agentNames = getAgentNames(count);
    this.subAgents = [];
    this.subTasks = {};
    this.subTaskResults = {};

    for (let i = 0; i < count; i++) {
      const agent = createSubAgent(i);
      agent.setDisplayName(this.agentNames[i]);
      this.subAgents.push(agent);
    }

    // Wire sibling references
    for (let i = 0; i < count; i++) {
      const siblings = this.subAgents
        .filter((_, j) => j !== i)
        .map(a => ({ agentId: a.agentId, displayName: a.displayName }));
      this.subAgents[i].setSiblingAgents(siblings);
    }
  }

  async receiveQuestion(fromAgentId, question) {
    const fromName = this.agentNames[this._agentIndex(fromAgentId)] || fromAgentId;
    this.log('question_received', { from: fromAgentId, question });

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

  async receiveMessage(fromAgentId, message) {
    return this.receiveQuestion(fromAgentId, message);
  }

  _agentIndex(agentId) {
    const m = String(agentId).match(/sub-agent-(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  _agentKey(index) {
    return String(index);
  }

  log(event, data = {}) {
    this.executionLog.push({ timestamp: new Date().toISOString(), event, ...data });
  }

  async processTask(task, onMessage = null) {
    this.executionLog = [];
    this.log('task_started', { task });

    this.conversationHistory.push({ role: 'user', content: `User's task: "${task}"` });

    if (onMessage) {
      onMessage({ type: 'status', agent: 'master-handler', message: 'Analyzing task complexity and determining agent count...' });
    }

    // Step 1: Analyze task — the LLM decides how many agents and what subtasks
    const analysisResult = await withRetry(
      () => this.analyzeTask(task),
      'task_analysis',
      (retryInfo) => {
        this.log('retry', retryInfo);
        if (onMessage) {
          onMessage({ type: 'retry', agent: 'master-handler', message: `Retrying task analysis (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`, ...retryInfo });
        }
      }
    );

    if (!analysisResult.success) {
      this.log('task_analysis_failed', { error: analysisResult.error });
      throw new Error(`Task analysis failed after ${analysisResult.attempts} attempts: ${analysisResult.error}`);
    }

    const taskAnalysis = analysisResult.result;
    const agentCount = taskAnalysis.subtasks.length;
    this.log('task_analyzed', { explanation: taskAnalysis.explanation, agentCount });

    // Spawn the determined number of agents
    this._spawnAgents(agentCount);

    // Send agent names to frontend
    if (onMessage) {
      onMessage({ type: 'agent-names', names: this.agentNames, count: agentCount });
    }

    if (onMessage) {
      onMessage({
        type: 'task-breakdown',
        agent: 'master-handler',
        message: taskAnalysis.explanation,
        subtasks: taskAnalysis.subtasks
      });
    }

    // Step 2: Assign subtasks
    for (let i = 0; i < agentCount; i++) {
      this.subTasks[i] = taskAnalysis.subtasks[i];
    }

    const agentNameList = Object.values(this.agentNames).join(', ');
    if (onMessage) {
      onMessage({ type: 'status', agent: 'master-handler', message: `Assigning subtasks to ${agentNameList}...` });
      onMessage({ type: 'status', agent: 'master-handler', message: `Waiting for all agents to complete...` });
    }

    // Step 3: Process all subtasks in parallel
    const results = await this.processSubTasksWithRecovery(taskAnalysis.subtasks, onMessage);

    // Log sub-agent results to dashboard (Round 1)
    if (onMessage) {
      for (let i = 0; i < agentCount; i++) {
        if (results[i]) {
          onMessage({ type: 'agent-result', agent: i, agentIndex: i, message: results[i], round: 1 });
        }
      }
    }

    // Check for partial failures
    const anyFailed = results.some((r, i) => r && r.startsWith('['));
    if (anyFailed && onMessage) {
      onMessage({ type: 'warning', agent: 'master-handler', message: 'One or more agents encountered issues. Proceeding with available results.' });
    }

    // Step 4: Evaluation & Follow-up Loop
    const MAX_FOLLOW_UP_ROUNDS = 2;
    const allResults = {};
    for (let i = 0; i < agentCount; i++) {
      allResults[i] = [results[i]];
    }

    for (let round = 1; round <= MAX_FOLLOW_UP_ROUNDS; round++) {
      if (onMessage) {
        onMessage({ type: 'status', agent: 'master-handler', message: `Evaluating agent results (round ${round})...` });
      }

      const latestResults = {};
      for (let i = 0; i < agentCount; i++) {
        latestResults[i] = allResults[i][allResults[i].length - 1];
      }

      const evaluation = await this.evaluateResults(task, latestResults);
      this.log('evaluation', { round, satisfied: evaluation.satisfied });

      if (onMessage) {
        onMessage({ type: 'evaluation', agent: 'master-handler', message: evaluation.reasoning, satisfied: evaluation.satisfied, round });
      }

      if (evaluation.satisfied) {
        this.log('evaluation_satisfied', { round });
        break;
      }

      // Assign follow-up tasks
      if (onMessage) {
        onMessage({ type: 'status', agent: 'master-handler', message: `Assigning follow-up tasks (round ${round})...` });
      }

      const followUpPromises = [];

      for (let i = 0; i < agentCount; i++) {
        const followUp = evaluation.followUps[i];
        if (!followUp) continue;

        const previousOutput = allResults[i][allResults[i].length - 1] || '';
        const enrichedTask = `FOLLOW-UP REQUEST FROM MASTER HANDLER\n\nYour previous output was:\n--- YOUR PREVIOUS OUTPUT ---\n${previousOutput}\n--- END PREVIOUS OUTPUT ---\n\nMaster Handler's evaluation: ${evaluation.reasoning}\n\nFollow-up task: ${followUp}\n\nPlease address the gaps identified above and produce an improved, more complete response. Build on your previous work — do not start from scratch.`;

        this.log('follow_up_assigned', { agent: i, round, task: followUp });
        if (onMessage) {
          onMessage({ type: 'follow-up-assignment', agent: 'master-handler', target: i, agentIndex: i, message: followUp, round: round + 1 });
        }

        followUpPromises.push(
          this.processFollowUpTask(i, enrichedTask, onMessage)
            .then(r => ({ agentIndex: i, result: r }))
            .catch(e => ({ agentIndex: i, result: `[Follow-up failed: ${e.message}]` }))
        );
      }

      if (followUpPromises.length === 0) break;

      const followUpResults = await Promise.all(followUpPromises);

      for (const { agentIndex, result } of followUpResults) {
        allResults[agentIndex].push(result);
        if (onMessage) {
          onMessage({ type: 'agent-result', agent: agentIndex, agentIndex, message: result, round: round + 1 });
        }
      }
    }

    // Step 5: Synthesize all results
    if (onMessage) {
      onMessage({ type: 'status', agent: 'master-handler', message: `Synthesizing results from all ${agentCount} agents...` });
    }

    const synthesisResult = await withRetry(
      () => this.synthesizeResults(task, allResults),
      'result_synthesis',
      (retryInfo) => {
        this.log('retry', retryInfo);
        if (onMessage) {
          onMessage({ type: 'retry', agent: 'master-handler', message: `Retrying result synthesis (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`, ...retryInfo });
        }
      }
    );

    if (!synthesisResult.success) {
      this.log('synthesis_failed', { error: synthesisResult.error });
      throw new Error(`Result synthesis failed after ${synthesisResult.attempts} attempts: ${synthesisResult.error}`);
    }

    const synthesis = synthesisResult.result;

    this.conversationHistory.push({ role: 'assistant', content: synthesis });
    this.log('task_completed', { synthesisLength: synthesis.length });

    if (onMessage) {
      onMessage({ type: 'complete', agent: 'master-handler', message: synthesis });
    }

    return synthesis;
  }

  async processSubTasksWithRecovery(subtasks, onMessage = null) {
    const onCommunication = (commEvent) => {
      this.log('inter_agent_communication', commEvent);
      if (onMessage) onMessage(commEvent);
    };

    const promises = subtasks.map((subtask, i) => this.processSubTask(i, subtask, onMessage, onCommunication));
    const settled = await Promise.allSettled(promises);

    const results = settled.map((res, i) => {
      if (res.status === 'fulfilled') {
        return res.value;
      } else {
        this.log(`subtask_${i}_failed`, { error: res.reason?.message });
        return `[${this.agentNames[i] || `Agent-${i}`} failed: ${res.reason?.message || 'Unknown error'}]`;
      }
    });

    const allFailed = settled.every(r => r.status === 'rejected');
    if (allFailed) {
      throw new Error('All agents failed: ' + settled.map((r, i) => `Agent-${i}: ${r.reason?.message}`).join('; '));
    }

    return results;
  }

  async analyzeTask(task) {
    const analysisPrompt = `Analyze this task and determine how many Agents (between 1 and ${MAX_SUB_AGENTS}) are needed to solve it effectively.

IMPORTANT:
- Simple or single-focus tasks may only need 1 agent.
- Moderate tasks that can be split into 2-3 independent parts should use 2-3 agents.
- Complex tasks with many independent components can use up to ${MAX_SUB_AGENTS} agents.
- Each subtask MUST be meaningfully DIFFERENT from the others.
- NEVER create more subtasks than there are genuinely independent aspects of the work.

Task: "${task}"

You MUST provide your response in this EXACT format (do not deviate):
AGENT_COUNT: [number between 1 and ${MAX_SUB_AGENTS}]
EXPLANATION: [Brief explanation of how you're breaking down the task and why you chose this number of agents]
SUBTASK 1: [First subtask - a specific, distinct portion of the work]
SUBTASK 2: [Second subtask - if needed]
SUBTASK 3: [Third subtask - if needed]
SUBTASK 4: [Fourth subtask - if needed]
SUBTASK 5: [Fifth subtask - if needed]

Only include as many SUBTASK lines as the AGENT_COUNT indicates.`;

    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: analysisPrompt }
    ]);

    let agentCount = 2;
    let explanation = '';
    const subtasks = [];

    const lines = response.split('\n');
    let currentField = '';
    let currentSubtaskIdx = -1;

    for (const line of lines) {
      const stripped = line.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '').trim();

      if (/^AGENT_COUNT\s*:/i.test(stripped)) {
        const val = parseInt(stripped.replace(/^AGENT_COUNT\s*:/i, '').trim(), 10);
        if (val >= 1 && val <= MAX_SUB_AGENTS) agentCount = val;
        currentField = 'agent_count';
      } else if (/^EXPLANATION\s*:/i.test(stripped)) {
        currentField = 'explanation';
        explanation = stripped.replace(/^EXPLANATION\s*:/i, '').trim();
      } else if (/^SUBTASK\s*(\d+)\s*:/i.test(stripped)) {
        const match = stripped.match(/^SUBTASK\s*(\d+)\s*:/i);
        currentSubtaskIdx = parseInt(match[1], 10) - 1;
        currentField = 'subtask';
        const content = stripped.replace(/^SUBTASK\s*\d+\s*:/i, '').trim();
        if (content) {
          subtasks[currentSubtaskIdx] = content;
        }
      } else if (stripped) {
        if (currentField === 'explanation') {
          explanation += ' ' + stripped;
        } else if (currentField === 'subtask' && currentSubtaskIdx >= 0) {
          subtasks[currentSubtaskIdx] = (subtasks[currentSubtaskIdx] || '') + ' ' + stripped;
        }
      }
    }

    // Sanitize
    const cleanSubtasks = subtasks.filter(s => s && s.trim()).map(s => s.trim());

    // If parsing failed, fall back
    if (cleanSubtasks.length === 0) {
      cleanSubtasks.push(`First aspect of: ${task}`);
      cleanSubtasks.push(`Second aspect of: ${task}`);
      agentCount = 2;
    }

    // Ensure count matches subtasks
    while (cleanSubtasks.length < agentCount) {
      cleanSubtasks.push(`Additional aspect ${cleanSubtasks.length + 1} of: ${task}`);
    }
    if (cleanSubtasks.length > agentCount) {
      cleanSubtasks.length = agentCount;
    }

    // Clamp to MAX_SUB_AGENTS
    if (cleanSubtasks.length > MAX_SUB_AGENTS) {
      cleanSubtasks.length = MAX_SUB_AGENTS;
    }

    if (!explanation) explanation = `Breaking the task into ${cleanSubtasks.length} subtasks.`;

    return { explanation: explanation.trim(), subtasks: cleanSubtasks };
  }

  async processSubTask(agentIndex, subtask, onMessage, onCommunication = null) {
    if (onMessage) {
      onMessage({ type: 'status', agent: agentIndex, agentIndex, message: 'Processing subtask...' });
    }

    const onChunk = onMessage
      ? (chunk) => onMessage({ type: 'streaming', agent: agentIndex, agentIndex, chunk })
      : null;

    const result = await withRetry(
      () => this.subAgents[agentIndex].processSubtask(subtask, onChunk, onCommunication),
      `subtask_${agentIndex}`,
      (retryInfo) => {
        this.log('retry', { ...retryInfo, agent: agentIndex });
        if (onMessage) {
          onMessage({ type: 'retry', agent: agentIndex, agentIndex, message: `Retrying subtask (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`, ...retryInfo });
        }
      }
    );

    if (!result.success) throw new Error(result.error);

    if (onMessage) {
      onMessage({ type: 'stream-end', agent: agentIndex, agentIndex });
    }

    console.log(`\n===== AGENT ${agentIndex} (${this.agentNames[agentIndex]}) RESULT (${result.result?.length || 0} chars) =====`);
    console.log(result.result?.substring(0, 300) + (result.result?.length > 300 ? '...' : ''));
    console.log(`===== END AGENT ${agentIndex} RESULT =====\n`);

    if (onMessage) {
      onMessage({ type: 'task-complete', agent: agentIndex, agentIndex, message: 'Subtask completed' });
    }

    return result.result;
  }

  async synthesizeResults(originalTask, allResults) {
    const agentBlocks = [];
    for (let i = 0; i < this.agentCount; i++) {
      const agentName = this.agentNames[i];
      const results = allResults[i] || [];
      if (results.length === 1) {
        agentBlocks.push(`${agentName} produced this output:\n--- ${agentName.toUpperCase()} OUTPUT ---\n${results[0]}\n--- END ---`);
      } else {
        const parts = results.map((r, j) => {
          const label = j === 0 ? 'Initial task' : `Follow-up round ${j}`;
          return `${agentName} - ${label}:\n--- ${agentName.toUpperCase()} ROUND ${j + 1} ---\n${r}\n--- END ---`;
        });
        agentBlocks.push(parts.join('\n\n'));
      }
    }

    const totalRounds = Math.max(...Object.values(allResults).map(r => r.length));
    const roundsNote = totalRounds > 1
      ? `\n\nNote: The agents completed ${totalRounds} round(s) of work. Incorporate findings from ALL rounds.`
      : '';

    const agentNameList = Object.values(this.agentNames).map(n => `"${n}"`).join(', ');

    const synthesisPrompt = `You are the Master Handler synthesizing results from your ${this.agentCount} Agents: ${agentNameList}.

The user originally requested: "${originalTask}"

${agentBlocks.join('\n\n')}
${roundsNote}

IMPORTANT: Always refer to the agents by their names. The outputs above ARE the completed results. Synthesize these results into a coherent, complete final response for the user. Combine findings, address overlaps or conflicts, and present a unified solution.`;

    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: synthesisPrompt }
    ]);

    return response;
  }

  async evaluateResults(originalTask, latestResults) {
    const agentBlocks = [];
    for (let i = 0; i < this.agentCount; i++) {
      const agentName = this.agentNames[i];
      agentBlocks.push(`${agentName}'s latest output:\n--- ${agentName.toUpperCase()} ---\n${latestResults[i] || '[No output]'}\n--- END ${agentName.toUpperCase()} ---`);
    }

    const agentNameList = Object.values(this.agentNames).map(n => `"${n}"`).join(', ');

    let followUpLines = '';
    for (let i = 0; i < this.agentCount; i++) {
      followUpLines += `FOLLOW_UP_${i}: [Follow-up task for ${this.agentNames[i]}, or NONE if their work is adequate]\n`;
    }

    const evaluationPrompt = `You are the Master Handler evaluating your Agents' work.

Original user task: "${originalTask}"

${agentBlocks.join('\n\n')}

Critically evaluate whether these results TOGETHER adequately address the user's task.
Consider: completeness, depth, accuracy, relevance, and whether anything important is missing.

IMPORTANT: Always refer to the agents by their names: ${agentNameList}.

You MUST respond in this EXACT format:

VERDICT: SATISFIED or NEEDS_FOLLOW_UP
REASONING: [Brief explanation of your evaluation]
${followUpLines}
Only request follow-ups for genuinely important gaps. Minor stylistic issues do not warrant follow-ups.`;

    const response = await chat([
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT },
      { role: 'user', content: evaluationPrompt }
    ]);

    let satisfied = true;
    let reasoning = '';
    const followUps = {};

    const responseLines = response.split('\n');
    let currentField = '';
    let currentFollowUpIdx = -1;

    for (const line of responseLines) {
      const stripped = line.replace(/^\*\*|\*\*$/g, '').replace(/^#+\s*/, '').trim();

      if (/^VERDICT\s*:/i.test(stripped)) {
        const verdict = stripped.replace(/^VERDICT\s*:/i, '').trim().toUpperCase();
        satisfied = !verdict.includes('NEEDS_FOLLOW_UP') && !verdict.includes('FOLLOW');
        currentField = 'verdict';
      } else if (/^REASONING\s*:/i.test(stripped)) {
        currentField = 'reasoning';
        reasoning = stripped.replace(/^REASONING\s*:/i, '').trim();
      } else if (/^FOLLOW_UP_(\d+)\s*:/i.test(stripped)) {
        const match = stripped.match(/^FOLLOW_UP_(\d+)\s*:/i);
        currentFollowUpIdx = parseInt(match[1], 10);
        currentField = 'followup';
        const val = stripped.replace(/^FOLLOW_UP_\d+\s*:/i, '').trim();
        if (val && !/^NONE$/i.test(val) && !/^N\/A$/i.test(val)) {
          followUps[currentFollowUpIdx] = val;
        }
      } else if (/^FOLLOW_UP_ALPHA\s*:/i.test(stripped)) {
        currentFollowUpIdx = 0;
        currentField = 'followup';
        const val = stripped.replace(/^FOLLOW_UP_ALPHA\s*:/i, '').trim();
        if (val && !/^NONE$/i.test(val) && !/^N\/A$/i.test(val)) {
          followUps[0] = val;
        }
      } else if (/^FOLLOW_UP_BETA\s*:/i.test(stripped)) {
        currentFollowUpIdx = 1;
        currentField = 'followup';
        const val = stripped.replace(/^FOLLOW_UP_BETA\s*:/i, '').trim();
        if (val && !/^NONE$/i.test(val) && !/^N\/A$/i.test(val)) {
          followUps[1] = val;
        }
      } else if (stripped) {
        if (currentField === 'reasoning') {
          reasoning += ' ' + stripped;
        } else if (currentField === 'followup' && currentFollowUpIdx >= 0 && followUps[currentFollowUpIdx]) {
          followUps[currentFollowUpIdx] += ' ' + stripped;
        }
      }
    }

    if (!satisfied && Object.keys(followUps).length === 0) {
      satisfied = true;
      reasoning += ' (No specific follow-up tasks identified, proceeding with current results.)';
    }

    if (!reasoning) reasoning = satisfied ? 'Results are satisfactory.' : 'Results need improvement.';

    console.log(`\n===== EVALUATION: ${satisfied ? 'SATISFIED' : 'NEEDS FOLLOW-UP'} =====`);
    console.log(`Reasoning: ${reasoning}`);
    for (const [idx, task] of Object.entries(followUps)) {
      console.log(`Follow-up Agent-${idx}: ${task}`);
    }
    console.log('===== END EVALUATION =====\n');

    return { satisfied, reasoning, followUps };
  }

  async processFollowUpTask(agentIndex, followUpTask, onMessage = null) {
    const subAgent = this.subAgents[agentIndex];

    if (onMessage) {
      onMessage({ type: 'status', agent: agentIndex, agentIndex, message: 'Processing follow-up task...' });
    }

    const onCommunication = (commEvent) => {
      this.log('inter_agent_communication', commEvent);
      if (onMessage) onMessage(commEvent);
    };

    const onChunk = onMessage
      ? (chunk) => onMessage({ type: 'streaming', agent: agentIndex, agentIndex, chunk })
      : null;

    const result = await withRetry(
      () => subAgent.processSubtask(followUpTask, onChunk, onCommunication),
      `follow_up_${agentIndex}`,
      (retryInfo) => {
        this.log('retry', { ...retryInfo, agent: agentIndex });
        if (onMessage) {
          onMessage({ type: 'retry', agent: agentIndex, agentIndex, message: `Retrying follow-up (attempt ${retryInfo.attempt}/${retryInfo.maxRetries})...`, ...retryInfo });
        }
      }
    );

    if (!result.success) throw new Error(result.error);

    if (onMessage) {
      onMessage({ type: 'stream-end', agent: agentIndex, agentIndex });
    }

    console.log(`\n===== AGENT ${agentIndex} (${this.agentNames[agentIndex]}) FOLLOW-UP RESULT (${result.result?.length || 0} chars) =====`);
    console.log(result.result?.substring(0, 300) + (result.result?.length > 300 ? '...' : ''));
    console.log(`===== END AGENT ${agentIndex} FOLLOW-UP =====\n`);

    if (onMessage) {
      onMessage({ type: 'task-complete', agent: agentIndex, agentIndex, message: 'Follow-up completed' });
    }

    return result.result;
  }

  getExecutionLog() { return [...this.executionLog]; }

  reset() {
    this.conversationHistory = [
      { role: 'system', content: MASTER_HANDLER_SYSTEM_PROMPT }
    ];
    for (const agent of this.subAgents) {
      agent.reset();
    }
    this.subTasks = {};
    this.subTaskResults = {};
    this.executionLog = [];

    const bus = getCommunicationBus();
    bus.clearHistory();
    bus.registerAgent('master-handler', this);
  }
}

export function createMasterHandler() {
  return new MasterHandler();
}

export default {
  MasterHandler,
  createMasterHandler,
  withRetry,
  RETRY_CONFIG
};
