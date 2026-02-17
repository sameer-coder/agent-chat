import { chat, chatStream } from './openaiService.js';

/**
 * Maximum number of questions a sub-agent can ask during a single subtask
 * to prevent infinite question loops.
 */
const MAX_QUESTIONS_PER_TASK = 5;

// System prompt for Sub-Agents
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
• Ask "alpha" (if you are Beta) or "beta" (if you are Alpha) when the other
  agent is working on a related subtask and likely has relevant domain details,
  partial results, or specialized knowledge that complements your own.

To ask a question, output EXACTLY this format on its own line:
ASK_QUESTION_TO: <target> QUESTION: <your question>

Examples:
ASK_QUESTION_TO: master QUESTION: Should I prioritize performance over readability?
ASK_QUESTION_TO: alpha QUESTION: What data format are you using so I can match it?

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

  /**
   * Register an agent with the communication bus
   * @param {string} agentId - The agent's unique identifier
   * @param {SubAgent} agent - The agent instance
   */
  registerAgent(agentId, agent) {
    this.agents.set(agentId, agent);
  }

  /**
   * Unregister an agent from the communication bus
   * @param {string} agentId - The agent's unique identifier
   */
  unregisterAgent(agentId) {
    this.agents.delete(agentId);
  }

  /**
   * Send a message from one agent to another
   * @param {string} fromAgentId - Sender's agent ID
   * @param {string} toAgentId - Recipient's agent ID
   * @param {string} message - The message content
   * @returns {Promise<Object>} Response object with success status and response
   */
  async sendMessage(fromAgentId, toAgentId, message) {
    const recipient = this.agents.get(toAgentId);
    
    if (!recipient) {
      return {
        success: false,
        error: `Agent ${toAgentId} not found or not registered`
      };
    }

    // Record the message in history
    const messageRecord = {
      timestamp: new Date().toISOString(),
      from: fromAgentId,
      to: toAgentId,
      message
    };
    this.messageHistory.push(messageRecord);

    // Deliver the message to the recipient
    const response = await recipient.receiveMessage(fromAgentId, message);

    return {
      success: true,
      response,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Resolve a human-friendly target name to a registered agent ID.
   * Supports: "master", "alpha", "beta", or direct agent IDs.
   * @param {string} target - Target name or ID
   * @returns {string|null} Resolved agent ID or null
   */
  resolveAgentId(target) {
    const normalized = (target || '').trim().toLowerCase();
    const aliasMap = {
      'master': 'master-handler',
      'master-handler': 'master-handler',
      'alpha': 'sub-agent-alpha',
      'sub-agent-alpha': 'sub-agent-alpha',
      'beta': 'sub-agent-beta',
      'sub-agent-beta': 'sub-agent-beta'
    };
    const resolved = aliasMap[normalized] || null;
    return resolved && this.agents.has(resolved) ? resolved : null;
  }

  /**
   * Route a question from one agent to another and return the answer.
   * The recipient's receiveQuestion (or receiveMessage) is invoked.
   * @param {string} fromAgentId - Sender's agent ID
   * @param {string} targetName - Human-friendly target ("master", "alpha", "beta")
   * @param {string} question - The question text
   * @returns {Promise<Object>} { success, answer, resolvedTarget, timestamp }
   */
  async askQuestion(fromAgentId, targetName, question) {
    const resolvedId = this.resolveAgentId(targetName);

    if (!resolvedId) {
      return {
        success: false,
        error: `Could not resolve target "${targetName}". Available agents: ${[...this.agents.keys()].join(', ')}`
      };
    }

    // Prevent agent from asking itself
    if (resolvedId === fromAgentId) {
      return {
        success: false,
        error: 'An agent cannot ask itself a question.'
      };
    }

    const recipient = this.agents.get(resolvedId);

    // Record the question
    const record = {
      timestamp: new Date().toISOString(),
      type: 'question',
      from: fromAgentId,
      to: resolvedId,
      message: question
    };
    this.messageHistory.push(record);

    // Use receiveQuestion if available, otherwise fall back to receiveMessage
    let answer;
    if (typeof recipient.receiveQuestion === 'function') {
      answer = await recipient.receiveQuestion(fromAgentId, question);
    } else {
      answer = await recipient.receiveMessage(fromAgentId, question);
    }

    // Record the answer
    this.messageHistory.push({
      timestamp: new Date().toISOString(),
      type: 'answer',
      from: resolvedId,
      to: fromAgentId,
      message: answer
    });

    return {
      success: true,
      answer,
      resolvedTarget: resolvedId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get message history for a specific agent
   * @param {string} agentId - The agent's ID
   * @returns {Array} Array of messages involving this agent
   */
  getMessageHistory(agentId) {
    return this.messageHistory.filter(
      msg => msg.from === agentId || msg.to === agentId
    );
  }

  /**
   * Clear message history
   */
  clearHistory() {
    this.messageHistory = [];
  }
}

// Singleton communication bus
const communicationBus = new AgentCommunicationBus();

/**
 * Get the global communication bus
 * @returns {AgentCommunicationBus}
 */
export function getCommunicationBus() {
  return communicationBus;
}

/**
 * Create a Sub-Agent with a specific name and ID
 * @param {string} name - Agent name (Alpha or Beta)
 * @param {string} agentId - Unique agent identifier
 */
export class SubAgent {
  constructor(name, agentId) {
    this.name = name;
    this.agentId = agentId;
    this.currentTask = null;
    this.conversationHistory = [
      { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT }
    ];
    this.pendingCommunications = [];
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.questionsAsked = 0;
  }

  /**
   * Detect ASK_QUESTION_TO directives in an LLM response.
   * Returns an array of { target, question } objects.
   * @param {string} text - The LLM output to scan
   * @returns {Array<{target: string, question: string}>}
   */
  static parseQuestions(text) {
    const regex = /ASK_QUESTION_TO:\s*(\S+)\s+QUESTION:\s*(.+)/gi;
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        target: match[1].trim().toLowerCase(),
        question: match[2].trim()
      });
    }
    return results;
  }

  /**
   * Process a subtask assigned by the Master Handler.
   * Includes an autonomous question-asking loop: if the LLM output contains
   * ASK_QUESTION_TO directives, the questions are routed through the communication
   * bus, answers are fed back to the LLM, and processing continues until the
   * agent produces a final answer or hits the question limit.
   *
   * @param {string} subtask - The subtask to work on
   * @param {Function} onChunk - Callback for streaming responses
   * @param {Function} onCommunication - Callback for inter-agent communication events
   * @returns {Promise<string>} The agent's response
   */
  async processSubtask(subtask, onChunk = null, onCommunication = null) {
    this.currentTask = subtask;
    this.questionsAsked = 0;

    // Identify self to the LLM
    const selfLabel = this.name; // "Alpha" or "Beta"
    const otherLabel = selfLabel === 'Alpha' ? 'beta' : 'alpha';

    // Add user message with the subtask
    this.conversationHistory.push({
      role: 'user',
      content: `You are Agent ${selfLabel}. Master Handler has assigned you this subtask: "${subtask}".\n\nPlease complete this subtask and report your findings/results.\nIf you need information you don't have, ask a question using:\nASK_QUESTION_TO: <master|${otherLabel}> QUESTION: <your question>\nOtherwise, produce your final answer directly.`
    });

    try {
      let response = await this._getLLMResponse(onChunk);

      // ── Question-asking loop ──
      let questions = SubAgent.parseQuestions(response);

      while (questions.length > 0 && this.questionsAsked < MAX_QUESTIONS_PER_TASK) {
        // Add the (partial) assistant response that contained the question(s)
        this.conversationHistory.push({
          role: 'assistant',
          content: response
        });

        const answerParts = [];

        for (const { target, question } of questions) {
          if (this.questionsAsked >= MAX_QUESTIONS_PER_TASK) break;
          this.questionsAsked++;

          // Notify dashboard about the question
          if (onCommunication) {
            onCommunication({
              type: 'agent-question',
              from: this.agentId,
              to: target,
              message: question
            });
          }

          // Route question through the communication bus
          const result = await communicationBus.askQuestion(
            this.agentId,
            target,
            question
          );

          if (result.success) {
            const answererLabel = result.resolvedTarget === 'master-handler' ? 'Master Handler'
              : result.resolvedTarget === 'sub-agent-alpha' ? 'Agent Alpha'
              : result.resolvedTarget === 'sub-agent-beta' ? 'Agent Beta'
              : result.resolvedTarget;

            answerParts.push(`Answer from ${answererLabel}: ${result.answer}`);

            // Notify dashboard about the answer
            if (onCommunication) {
              onCommunication({
                type: 'agent-answer',
                from: result.resolvedTarget,
                to: this.agentId,
                message: result.answer
              });
            }
          } else {
            answerParts.push(`Could not reach ${target}: ${result.error}`);
          }
        }

        // Feed answers back into the conversation
        this.conversationHistory.push({
          role: 'user',
          content: answerParts.join('\n\n') + '\n\nPlease continue your work incorporating the answers above. If you need more information, ask another question using the same format. Otherwise produce your final result.'
        });

        // Get next response
        response = await this._getLLMResponse(onChunk);
        questions = SubAgent.parseQuestions(response);
      }

      // Also handle legacy COMMUNICATE_TO format for backward compatibility
      const communicationMatches = response.matchAll(/COMMUNICATE_TO:\s*(\w+)\s*MESSAGE:\s*([^\n]+)/gi);
      const communications = Array.from(communicationMatches);

      if (communications.length > 0 && onCommunication) {
        for (const match of communications) {
          const targetAgent = match[1].toLowerCase();
          const message = match[2].trim();

          onCommunication({
            type: 'agent-communication',
            from: this.agentId,
            to: targetAgent,
            message: message
          });

          const targetAgentId = communicationBus.resolveAgentId(targetAgent);

          if (targetAgentId) {
            const commResult = await communicationBus.sendMessage(
              this.agentId,
              targetAgentId,
              message
            );

            if (commResult.success) {
              this.conversationHistory.push({
                role: 'assistant',
                content: response
              });
              this.conversationHistory.push({
                role: 'user',
                content: `Response from ${targetAgent}: ${commResult.response}`
              });

              response = await this._getLLMResponse(onChunk);
            }
          }
        }
      }

      // Add final assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response
      });

      return response;
    } catch (error) {
      throw new Error(`Agent ${this.name} error: ${error.message}`);
    }
  }

  /**
   * Internal helper — get a response from the LLM.
   * Tries streaming first; if that yields nothing, falls back to non-streaming chat().
   * @param {Function|null} onChunk - Streaming callback
   * @returns {Promise<string>} The full response text
   */
  async _getLLMResponse(onChunk = null) {
    if (onChunk) {
      // Try streaming first
      try {
        const chunks = [];
        for await (const chunk of chatStream(this.conversationHistory)) {
          chunks.push(chunk);
          onChunk(chunk);
        }
        if (chunks.length > 0) {
          return chunks.join('');
        }
        // Streaming returned 0 chunks — fall back to non-streaming
        console.log(`[${this.name}] chatStream produced 0 chunks, falling back to chat()`);
      } catch (streamErr) {
        console.log(`[${this.name}] chatStream error, falling back to chat(): ${streamErr.message}`);
      }
      // Fallback: use non-streaming chat() and deliver result via onChunk
      const result = await chat(this.conversationHistory);
      if (result) {
        onChunk(result);
      }
      return result || '';
    } else {
      return await chat(this.conversationHistory);
    }
  }

  /**
   * Receive a question from another agent and produce an answer
   * based on the current conversation context.
   * @param {string} fromAgentId - The sender's agent ID
   * @param {string} question - The question text
   * @returns {Promise<string>} Answer to the question
   */
  async receiveQuestion(fromAgentId, question) {
    const fromName = fromAgentId === 'sub-agent-alpha' ? 'Alpha'
      : fromAgentId === 'sub-agent-beta' ? 'Beta'
      : fromAgentId === 'master-handler' ? 'Master Handler'
      : fromAgentId;

    this.conversationHistory.push({
      role: 'user',
      content: `${fromName} is asking you a question:\n"${question}"\n\nPlease answer the question based on your current knowledge and work. Keep your answer focused, helpful, and relevant. Do NOT use the ASK_QUESTION_TO format in your answer.`
    });

    try {
      const response = await chat(this.conversationHistory);
      this.conversationHistory.push({
        role: 'assistant',
        content: response
      });
      return response;
    } catch (error) {
      return `Error answering question: ${error.message}`;
    }
  }

  /**
   * Receive a message from another agent (legacy / general purpose)
   * @param {string} fromAgentId - The sender's agent ID
   * @param {string} message - The message content
   * @returns {Promise<string>} Response to the message
   */
  async receiveMessage(fromAgentId, message) {
    const fromName = fromAgentId === 'sub-agent-alpha' ? 'Alpha' : 
                     fromAgentId === 'sub-agent-beta' ? 'Beta' : fromAgentId;
    
    this.conversationHistory.push({
      role: 'user',
      content: `Message from Agent ${fromName}: ${message}\n\nPlease respond appropriately. Keep your response focused and relevant to your current task.`
    });
    
    try {
      const response = await chat(this.conversationHistory);
      
      this.conversationHistory.push({
        role: 'assistant',
        content: response
      });
      
      return response;
    } catch (error) {
      return `Error processing message: ${error.message}`;
    }
  }

  /**
   * Send a message to another agent through the communication bus
   * @param {string} recipientName - The recipient agent name (Alpha or Beta)
   * @param {string} message - The message to send
   * @returns {Promise<Object>} Response from the other agent
   */
  async sendMessageToAgent(recipientName, message) {
    const recipientId = communicationBus.resolveAgentId(recipientName);
    
    if (!recipientId) {
      throw new Error(`Unknown recipient: ${recipientName}`);
    }
    
    const result = await communicationBus.sendMessage(this.agentId, recipientId, message);
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result;
  }

  /**
   * Get the current conversation history
   * @returns {Array} Conversation history
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Clear the conversation history (keep system prompt)
   */
  reset() {
    this.currentTask = null;
    this.questionsAsked = 0;
    this.conversationHistory = [
      { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT }
    ];
    this.pendingCommunications = [];
  }
}

/**
 * Create a Sub-Agent Alpha
 * @returns {SubAgent} New Sub-Agent instance
 */
export function createSubAgentAlpha() {
  const agent = new SubAgent('Alpha', 'sub-agent-alpha');
  communicationBus.registerAgent('sub-agent-alpha', agent);
  return agent;
}

/**
 * Create a Sub-Agent Beta
 * @returns {SubAgent} New Sub-Agent instance
 */
export function createSubAgentBeta() {
  const agent = new SubAgent('Beta', 'sub-agent-beta');
  communicationBus.registerAgent('sub-agent-beta', agent);
  return agent;
}

export default {
  SubAgent,
  createSubAgentAlpha,
  createSubAgentBeta,
  getCommunicationBus
};
