import { chat, chatStream } from './openaiService.js';

// System prompt for Sub-Agents
const SUB_AGENT_SYSTEM_PROMPT = `You are a specialized Sub-Agent working on a task assigned by a Master Handler.

Your role:
1. Receive a specific subtask from the Master Handler
2. Work on completing that subtask to the best of your ability
3. You can communicate with other Sub-Agents if needed to coordinate or share information
4. Report your progress and results back to the Master Handler
5. Be clear, concise, and focused on your assigned subtask

When communicating:
- Always identify yourself as "Sub-Agent Alpha" or "Sub-Agent Beta"
- Share relevant findings that might help other agents
- Ask the Master Handler or other agents for clarification if needed
- Stay focused on your assigned portion of the work

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
  }

  /**
   * Process a subtask assigned by the Master Handler
   * @param {string} subtask - The subtask to work on
   * @param {Function} onChunk - Callback for streaming responses
   * @param {Function} onCommunication - Callback for inter-agent communication events
   * @returns {Promise<string>} The agent's response
   */
  async processSubtask(subtask, onChunk = null, onCommunication = null) {
    this.currentTask = subtask;
    
    // Add user message with the subtask
    this.conversationHistory.push({
      role: 'user',
      content: `Master Handler has assigned you this subtask: "${subtask}".\n\nPlease complete this subtask and report your findings/results. You can communicate with other agents if needed using the format: COMMUNICATE_TO: [agent-name] MESSAGE: [your message]`
    });
    
    try {
      let response;
      
      if (onChunk) {
        // Stream the response
        const chunks = [];
        for await (const chunk of chatStream(this.conversationHistory)) {
          chunks.push(chunk);
          onChunk(chunk);
        }
        response = chunks.join('');
      } else {
        // Get complete response
        response = await chat(this.conversationHistory);
      }
      
      // Check if the agent wants to communicate with another agent
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
          
          // Actually send the message through the communication bus
          const targetAgentId = targetAgent === 'alpha' ? 'sub-agent-alpha' : 
                               targetAgent === 'beta' ? 'sub-agent-beta' : null;
          
          if (targetAgentId) {
            const commResult = await communicationBus.sendMessage(
              this.agentId,
              targetAgentId,
              message
            );
            
            if (commResult.success) {
              // Add the response to conversation history
              this.conversationHistory.push({
                role: 'user',
                content: `Response from ${targetAgent}: ${commResult.response}`
              });
              
              // Get a new response incorporating the communication
              if (onChunk) {
                const newChunks = [];
                for await (const chunk of chatStream(this.conversationHistory)) {
                  newChunks.push(chunk);
                  onChunk(chunk);
                }
                response = newChunks.join('');
              } else {
                response = await chat(this.conversationHistory);
              }
            }
          }
        }
      }
      
      // Add assistant's response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response
      });
      
      return response;
    } catch (error) {
      throw new Error(`Sub-Agent ${this.name} error: ${error.message}`);
    }
  }

  /**
   * Receive a message from another agent
   * @param {string} fromAgentId - The sender's agent ID
   * @param {string} message - The message content
   * @returns {Promise<string>} Response to the message
   */
  async receiveMessage(fromAgentId, message) {
    const fromName = fromAgentId === 'sub-agent-alpha' ? 'Alpha' : 
                     fromAgentId === 'sub-agent-beta' ? 'Beta' : fromAgentId;
    
    this.conversationHistory.push({
      role: 'user',
      content: `Message from Sub-Agent ${fromName}: ${message}\n\nPlease respond appropriately. Keep your response focused and relevant to your current task.`
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
    const recipientId = recipientName.toLowerCase() === 'alpha' ? 'sub-agent-alpha' : 
                        recipientName.toLowerCase() === 'beta' ? 'sub-agent-beta' : null;
    
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
