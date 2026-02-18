import { chat, chatStream } from './openaiService.js';

const MAX_QUESTIONS_PER_TASK = 5;

export const MAX_SUB_AGENTS = 5;

const SUB_AGENT_SYSTEM_PROMPT = `You are a specialized Agent working on a task assigned by a Master Handler.

Your role:
1. Receive a specific subtask from the Master Handler
2. Work on completing that subtask to the best of your ability
3. You can communicate with other Agents if needed to coordinate or share information
4. Report your progress and results back to the Master Handler
5. Be clear, concise, and focused on your assigned subtask

When communicating:
- Always identify yourself by your agent name
- Share relevant findings that might help other agents
- Ask the Master Handler or other agents for clarification if needed
- Stay focused on your assigned portion of the work

CRITICAL — ASKING QUESTIONS:
During your work you may encounter situations where you need additional information,
clarification, context, or expertise that you do not have. When this happens you MUST
ask a question rather than guessing or making up an answer.

How to decide WHO to ask:
• Ask "master" when you need clarification about the original user task, overall
  project goals, constraints, priorities, or high-level decisions.
• Ask another agent by their agent-id (e.g. "agent-0", "agent-1", etc.) when
  that agent is working on a related subtask and likely has relevant domain details,
  partial results, or specialized knowledge that complements your own.

To ask a question, output EXACTLY this format on its own line:
ASK_QUESTION_TO: <target> QUESTION: <your question>

Examples:
ASK_QUESTION_TO: master QUESTION: Should I prioritize performance over readability?
ASK_QUESTION_TO: agent-1 QUESTION: What data format are you using so I can match it?

Rules:
- You may ask more than one question if needed (each on a separate line).
- Wait for the answer before continuing your work.
- Once you receive an answer, incorporate it and continue producing your final result.
- Only ask when genuinely necessary — do not ask questions you can answer yourself.
- Never ask more than ${MAX_QUESTIONS_PER_TASK} questions per subtask.

Remember: You are part of a team working together to solve a larger problem.`;

/**
 * Communication bus for inter-agent messaging
 */
class AgentCommunicationBus {
  constructor() {
    this.agents = new Map();
    this.messageHistory = [];
  }

  registerAgent(agentId, agent) {
    this.agents.set(agentId, agent);
  }

  unregisterAgent(agentId) {
    this.agents.delete(agentId);
  }

  async sendMessage(fromAgentId, toAgentId, message) {
    const recipient = this.agents.get(toAgentId);
    if (!recipient) {
      return { success: false, error: `Agent ${toAgentId} not found or not registered` };
    }
    this.messageHistory.push({
      timestamp: new Date().toISOString(),
      from: fromAgentId,
      to: toAgentId,
      message
    });
    const response = await recipient.receiveMessage(fromAgentId, message);
    return { success: true, response, timestamp: new Date().toISOString() };
  }

  resolveAgentId(target) {
    const normalized = (target || '').trim().toLowerCase();

    const staticAliases = {
      'master': 'master-handler',
      'master-handler': 'master-handler',
      'alpha': 'sub-agent-0',
      'sub-agent-alpha': 'sub-agent-0',
      'beta': 'sub-agent-1',
      'sub-agent-beta': 'sub-agent-1'
    };

    if (staticAliases[normalized]) {
      const resolved = staticAliases[normalized];
      return this.agents.has(resolved) ? resolved : null;
    }

    const agentMatch = normalized.match(/^agent-(\d+)$/);
    if (agentMatch) {
      const id = `sub-agent-${agentMatch[1]}`;
      return this.agents.has(id) ? id : null;
    }

    if (/^sub-agent-\d+$/.test(normalized)) {
      return this.agents.has(normalized) ? normalized : null;
    }

    return this.agents.has(normalized) ? normalized : null;
  }

  async askQuestion(fromAgentId, targetName, question) {
    const resolvedId = this.resolveAgentId(targetName);
    if (!resolvedId) {
      return {
        success: false,
        error: `Could not resolve target "${targetName}". Available agents: ${[...this.agents.keys()].join(', ')}`
      };
    }
    if (resolvedId === fromAgentId) {
      return { success: false, error: 'An agent cannot ask itself a question.' };
    }

    const recipient = this.agents.get(resolvedId);
    this.messageHistory.push({
      timestamp: new Date().toISOString(), type: 'question',
      from: fromAgentId, to: resolvedId, message: question
    });

    let answer;
    if (typeof recipient.receiveQuestion === 'function') {
      answer = await recipient.receiveQuestion(fromAgentId, question);
    } else {
      answer = await recipient.receiveMessage(fromAgentId, question);
    }

    this.messageHistory.push({
      timestamp: new Date().toISOString(), type: 'answer',
      from: resolvedId, to: fromAgentId, message: answer
    });

    return { success: true, answer, resolvedTarget: resolvedId, timestamp: new Date().toISOString() };
  }

  getMessageHistory(agentId) {
    return this.messageHistory.filter(msg => msg.from === agentId || msg.to === agentId);
  }

  clearHistory() {
    this.messageHistory = [];
  }
}

const communicationBus = new AgentCommunicationBus();

export function getCommunicationBus() {
  return communicationBus;
}

export class SubAgent {
  constructor(name, agentId) {
    this.name = name;
    this.agentId = agentId;
    this.displayName = name;
    this.otherAgents = [];
    this.currentTask = null;
    this.conversationHistory = [
      { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT }
    ];
    this.pendingCommunications = [];
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.questionsAsked = 0;
  }

  setDisplayName(displayName) { this.displayName = displayName; }

  setSiblingAgents(others) { this.otherAgents = others; }

  resolveDisplayName(agentId) {
    if (agentId === this.agentId) return this.displayName;
    if (agentId === 'master-handler') return 'Master Handler';
    const sibling = this.otherAgents.find(a => a.agentId === agentId);
    return sibling ? sibling.displayName : agentId;
  }

  static parseQuestions(text) {
    const regex = /ASK_QUESTION_TO:\s*(\S+)\s+QUESTION:\s*(.+)/gi;
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({ target: match[1].trim().toLowerCase(), question: match[2].trim() });
    }
    return results;
  }

  async processSubtask(subtask, onChunk = null, onCommunication = null) {
    this.currentTask = subtask;
    this.questionsAsked = 0;

    const selfLabel = this.displayName;
    const siblingLines = this.otherAgents.map(
      s => `  - "${s.agentId.replace('sub-', '')}" -> ${s.displayName}`
    ).join('\n');
    const siblingInfo = this.otherAgents.length > 0
      ? `\nYour sibling agents:\n${siblingLines}\n`
      : '';

    this.conversationHistory.push({
      role: 'user',
      content: `You are ${selfLabel}. Master Handler has assigned you this subtask: "${subtask}".\n${siblingInfo}\nPlease complete this subtask and report your findings/results.\nIf you need information you don't have, ask a question using:\nASK_QUESTION_TO: <master|agent-N> QUESTION: <your question>\nOtherwise, produce your final answer directly.`
    });

    try {
      let response = await this._getLLMResponse(onChunk);
      let questions = SubAgent.parseQuestions(response);

      while (questions.length > 0 && this.questionsAsked < MAX_QUESTIONS_PER_TASK) {
        this.conversationHistory.push({ role: 'assistant', content: response });
        const answerParts = [];

        for (const { target, question } of questions) {
          if (this.questionsAsked >= MAX_QUESTIONS_PER_TASK) break;
          this.questionsAsked++;

          if (onCommunication) {
            onCommunication({ type: 'agent-question', from: this.agentId, to: target, message: question });
          }

          const result = await communicationBus.askQuestion(this.agentId, target, question);

          if (result.success) {
            const answererLabel = this.resolveDisplayName(result.resolvedTarget);
            answerParts.push(`Answer from ${answererLabel}: ${result.answer}`);
            if (onCommunication) {
              onCommunication({ type: 'agent-answer', from: result.resolvedTarget, to: this.agentId, message: result.answer });
            }
          } else {
            answerParts.push(`Could not reach ${target}: ${result.error}`);
          }
        }

        this.conversationHistory.push({
          role: 'user',
          content: answerParts.join('\n\n') + '\n\nPlease continue your work incorporating the answers above. If you need more information, ask another question using the same format. Otherwise produce your final result.'
        });

        response = await this._getLLMResponse(onChunk);
        questions = SubAgent.parseQuestions(response);
      }

      // Legacy COMMUNICATE_TO handler
      const communicationMatches = response.matchAll(/COMMUNICATE_TO:\s*(\w+)\s*MESSAGE:\s*([^\n]+)/gi);
      const communications = Array.from(communicationMatches);
      if (communications.length > 0 && onCommunication) {
        for (const match of communications) {
          const targetAgent = match[1].toLowerCase();
          const message = match[2].trim();
          onCommunication({ type: 'agent-communication', from: this.agentId, to: targetAgent, message });
          const targetAgentId = communicationBus.resolveAgentId(targetAgent);
          if (targetAgentId) {
            const commResult = await communicationBus.sendMessage(this.agentId, targetAgentId, message);
            if (commResult.success) {
              this.conversationHistory.push({ role: 'assistant', content: response });
              this.conversationHistory.push({ role: 'user', content: `Response from ${targetAgent}: ${commResult.response}` });
              response = await this._getLLMResponse(onChunk);
            }
          }
        }
      }

      this.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } catch (error) {
      throw new Error(`Agent ${this.displayName} error: ${error.message}`);
    }
  }

  async _getLLMResponse(onChunk = null) {
    if (onChunk) {
      try {
        const chunks = [];
        for await (const chunk of chatStream(this.conversationHistory)) {
          chunks.push(chunk);
          onChunk(chunk);
        }
        if (chunks.length > 0) return chunks.join('');
        console.log(`[${this.displayName}] chatStream produced 0 chunks, falling back to chat()`);
      } catch (streamErr) {
        console.log(`[${this.displayName}] chatStream error, falling back to chat(): ${streamErr.message}`);
      }
      const result = await chat(this.conversationHistory);
      if (result) onChunk(result);
      return result || '';
    } else {
      return await chat(this.conversationHistory);
    }
  }

  async receiveQuestion(fromAgentId, question) {
    const fromName = this.resolveDisplayName(fromAgentId);
    this.conversationHistory.push({
      role: 'user',
      content: `${fromName} is asking you a question:\n"${question}"\n\nPlease answer the question based on your current knowledge and work. Keep your answer focused, helpful, and relevant. Do NOT use the ASK_QUESTION_TO format in your answer.`
    });
    try {
      const response = await chat(this.conversationHistory);
      this.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } catch (error) {
      return `Error answering question: ${error.message}`;
    }
  }

  async receiveMessage(fromAgentId, message) {
    const fromName = this.resolveDisplayName(fromAgentId);
    this.conversationHistory.push({
      role: 'user',
      content: `Message from ${fromName}: ${message}\n\nPlease respond appropriately. Keep your response focused and relevant to your current task.`
    });
    try {
      const response = await chat(this.conversationHistory);
      this.conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } catch (error) {
      return `Error processing message: ${error.message}`;
    }
  }

  getHistory() { return [...this.conversationHistory]; }

  reset() {
    this.currentTask = null;
    this.questionsAsked = 0;
    this.conversationHistory = [
      { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT }
    ];
    this.pendingCommunications = [];
  }
}

export function createSubAgent(index) {
  const agentId = `sub-agent-${index}`;
  const name = `Agent-${index}`;
  const agent = new SubAgent(name, agentId);
  communicationBus.registerAgent(agentId, agent);
  return agent;
}

export default {
  SubAgent,
  createSubAgent,
  getCommunicationBus,
  MAX_SUB_AGENTS
};
