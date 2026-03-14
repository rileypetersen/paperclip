# Agentic Prompt Engineering & Self-Improving Systems — Resource Directory

A curated directory of the most important resources for learning prompt engineering for agentic systems, multi-agent swarms, and self-improving AI.

---

## 1. Foundational Prompt Engineering

### Anthropic Prompt Engineering Docs
- **Link:** https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
- **Summary:** Anthropic's official guide covering tool use, system prompts, chain-of-thought, and agentic patterns. The single best starting point — written by the people who build the models.

### Building Effective Agents (Anthropic)
- **Link:** https://www.anthropic.com/engineering/building-effective-agents
- **Summary:** The canonical reference for agentic design patterns. Defines the taxonomy: prompt chaining, routing, orchestrator-worker, evaluator-optimizer, and autonomous agents. Covers when to use each pattern and common failure modes.

### OpenAI Prompt Engineering Guide
- **Link:** https://platform.openai.com/docs/guides/prompt-engineering
- **Summary:** OpenAI's official guide with complementary framing to Anthropic's. Cross-pollinating both builds model-agnostic intuition for structuring instructions, managing context, and eliciting reliable behavior.

### The Prompt Report (Schulhoff et al., 2024)
- **Link:** https://arxiv.org/abs/2406.06608
- **Summary:** A systematic survey that taxonomizes 58 text-based and 40 multimodal prompting techniques into a unified framework. Serves as both a reference guide for practitioners and a foundation for future research by consolidating best practices and identifying open problems in prompt design.

---

## 2. Agentic Frameworks & Multi-Agent Systems

### LangGraph (LangChain)
- **Link:** https://python.langchain.com/docs/langgraph
- **Summary:** The most comprehensive open-source framework for building agent graphs. Documentation covers state machines, checkpointing, human-in-the-loop patterns, and complex multi-step agent workflows.

### CrewAI
- **Link:** https://docs.crewai.com/
- **Summary:** Best resource specifically on multi-agent swarm patterns: role-based agents, delegation, sequential/parallel execution. Production-oriented examples for building teams of specialized agents that collaborate on tasks.

### OpenAI Swarm
- **Link:** https://github.com/openai/swarm
- **Summary:** OpenAI's lightweight, educational multi-agent framework. Minimal abstraction — ideal for understanding the core primitives (handoffs, routines, agent specialization) before adopting heavier frameworks.

### Microsoft AutoGen
- **Link:** https://github.com/microsoft/autogen
- **Summary:** Research-grade multi-agent conversation framework. Covers group chat architectures, agent specialization, and flexible conversation patterns. Strong on the theoretical foundations of multi-agent coordination.

### Anthropic Claude Agent SDK
- **Link:** https://github.com/anthropics/claude-code-sdk
- **Summary:** Shows how Anthropic structures agentic tool use, guardrails, and orchestration. Reference implementation for building agents with Claude.

---

## 3. Self-Reflection & Iterative Improvement

### Reflexion (Shinn et al., 2023)
- **Link:** https://arxiv.org/abs/2303.11366
- **Summary:** Introduces a reinforcement paradigm where language agents improve not by updating model weights, but by generating natural-language self-reflections on failures and storing them in an episodic memory buffer for subsequent attempts. Lightweight — layers on top of any LLM agent. Achieved 91% pass@1 on HumanEval (surpassing GPT-4's 80% at the time).

### Self-Refine (Madaan et al., 2023)
- **Link:** https://arxiv.org/abs/2303.17651
- **Summary:** A single LLM iteratively improves its own output through a generate-critique-refine loop — no additional training, fine-tuning, or RL required. Relies solely on prompting the same model for generation, feedback, and refinement. Achieved ~20% absolute improvement over standard one-shot generation across seven diverse tasks.

### LATS — Language Agent Tree Search (Zhou et al., 2023)
- **Link:** https://arxiv.org/abs/2310.04406
- **Summary:** Unifies reasoning, acting, and planning by combining LLMs with Monte Carlo Tree Search (MCTS). Uses the LM itself as both a value function and a source of self-reflective feedback, enabling systematic exploration with backtracking — unlike chain-of-thought approaches that commit to a single path. State-of-the-art across programming, QA, web navigation, and math reasoning.

### Voyager (Wang et al., 2023, NVIDIA)
- **Link:** https://arxiv.org/abs/2305.16291
- **Summary:** LLM-powered embodied agent that continuously explores and learns in Minecraft without human intervention. Combines an automatic curriculum that proposes increasingly difficult objectives, a skill library of reusable code programs that grows over time, and an iterative prompting loop using environment feedback to refine generated code. Obtains ~3x more unique items and unlocks milestones up to 15x faster than prior methods, producing compositional skills that transfer to new worlds.

---

## 4. Prompt Optimization & Self-Improvement

### OPRO — Optimization by PROmpting (Yang et al., 2023, Google DeepMind)
- **Link:** https://arxiv.org/abs/2309.03409
- **Summary:** Uses LLMs as general-purpose optimizers: describe the optimization problem in natural language, let the LLM iteratively propose candidates, score them, and feed results back to guide future proposals. OPRO-discovered instructions outperformed human-crafted prompts by up to 8% on GSM8K.

### PromptBreeder (Fernando et al., 2023, DeepMind)
- **Link:** https://arxiv.org/abs/2309.16797
- **Summary:** Self-referential evolutionary framework for automatic prompt optimization. Maintains a population of task-prompts mutated by LLM-generated "mutation-prompts," with fitness-based selection. The mutation operators themselves co-evolve — a recursive self-improvement loop where the system improves how it improves. Outperforms hand-crafted methods like Chain-of-Thought.

### DSPy (Stanford NLP)
- **Link:** https://github.com/stanfordnlp/dspy
- **Summary:** Framework that treats prompts as optimizable programs rather than static strings. Optimizers (BootstrapFewShot, MIPRO) automatically discover better prompts and few-shot examples by evaluating outputs against metrics. The most practical tool for programmatic, eval-driven prompt self-improvement.

### TextGrad (Yuksekgonul et al., 2024)
- **Link:** https://arxiv.org/abs/2406.07496
- **Summary:** Treats natural language feedback from LLMs as analogous to gradients in backpropagation, enabling automatic optimization of compound AI systems. LLMs generate textual critiques that propagate backward through a computation graph (PyTorch-style API), systematically improving prompts, code, or even molecular designs without manual tuning.

### Eureka (Ma et al., 2023, NVIDIA)
- **Link:** https://arxiv.org/abs/2310.12931
- **Summary:** Uses LLMs to automatically generate and iteratively refine reward function code for reinforcement learning. Through an evolutionary loop — propose reward functions, evaluate in simulation, improve via feedback — Eureka outperforms expert human-designed rewards on 83% of 29 benchmark tasks, achieving 52% average improvement. No task-specific prompt engineering required.

---

## 5. Memory & Accumulating Knowledge

### MemGPT (Packer et al., 2023)
- **Link:** https://arxiv.org/abs/2310.08560
- **Summary:** Introduces OS-inspired virtual memory management for LLMs — analogous to paging between main memory and disk. The model manages its own context window by moving information between fast "main context" and slower external storage via function calls and interrupts. Enables multi-session agents with persistent long-term memory and analysis over corpora too large for a single context window.

### Generative Agents (Park et al., 2023, Stanford)
- **Link:** https://arxiv.org/abs/2304.03442
- **Summary:** The "Smallville" paper. 25 agents in a sandbox environment with a memory stream, reflection mechanism (synthesizing memories into higher-level abstractions), and dynamic retrieval system. Agents autonomously exhibit emergent social behaviors like coordinating a Valentine's Day party from a single seed idea. Key insight: reflection transforms raw observations into higher-level learning.

### CoALA — Cognitive Architectures for Language Agents (Sumers et al., 2023)
- **Link:** https://arxiv.org/abs/2309.02427
- **Summary:** The theoretical unifying framework. Inspired by cognitive science and classical AI, it models agents with modular memory components (working, episodic, semantic, procedural), structured action spaces, and a generalized decision-making loop. Serves as both a taxonomy for existing research and a blueprint for designing more capable future agents.

---

## 6. Practitioner Blogs & Community

### Lilian Weng — LLM Powered Autonomous Agents
- **Link:** https://lilianweng.github.io/posts/2023-06-23-agent/
- **Summary:** Deep technical analysis of agent architectures by an OpenAI researcher. Covers planning, memory, and tool use in a single comprehensive post. Among the most cited references in the field.

### Lilian Weng — Prompt Engineering
- **Link:** https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/
- **Summary:** Comprehensive survey of prompting techniques for autoregressive language models, covering zero-shot, few-shot, chain-of-thought, self-consistency, tree of thoughts, and automatic prompt optimization methods. A reference companion to her autonomous agents post.

### Simon Willison's Weblog
- **Link:** https://simonwillison.net/
- **Summary:** Prolific practitioner who documents real-world agent patterns, prompt engineering techniques, failures, and lessons learned. The best "field notes" source for what actually works in production vs. what's theoretical.

### Andrew Ng — Agentic Design Patterns (2024)
- **Links:**
  - Part 1 (Intro): https://www.deeplearning.ai/the-batch/issue-242/
  - Part 2 (Reflection): https://www.deeplearning.ai/the-batch/agentic-design-patterns-part-2-reflection/
  - Part 3 (Tool Use): https://www.deeplearning.ai/the-batch/agentic-design-patterns-part-3-tool-use/
  - Part 4 (Planning): https://www.deeplearning.ai/the-batch/agentic-design-patterns-part-4-planning/
  - Part 5 (Multi-Agent): https://www.deeplearning.ai/the-batch/agentic-design-patterns-part-5-multi-agent-collaboration/
  - Course: https://learn.deeplearning.ai/courses/agentic-ai
- **Summary:** Five-part newsletter series arguing that reflection, tool use, planning, and multi-agent collaboration are the four patterns driving the most significant AI progress. The central insight: agentic workflows where an LLM iteratively refines its work unlock dramatically higher quality than single-pass generation. Later expanded into a full DeepLearning.AI course.

### Reddit Communities
- **r/PromptEngineering** — https://reddit.com/r/PromptEngineering — practitioners sharing real-world techniques
- **r/LocalLLaMA** — https://reddit.com/r/LocalLLaMA — open-source agent experimentation and benchmarking

---

## 7. Early Autonomous Agent Projects

### AutoGPT
- **Link:** https://github.com/Significant-Gravitas/AutoGPT
- **Summary:** One of the first high-profile demonstrations of an LLM-powered agent that autonomously chains thoughts and actions toward a user-defined goal — browsing the web, writing/executing code, and managing files without constant human prompting. Historically significant as the spark that ignited mainstream interest in autonomous AI agents, briefly topping GitHub stars globally.

### BabyAGI
- **Link:** https://github.com/yoheinakajima/babyagi
- **Summary:** Minimal task-driven autonomous agent (~100 lines of Python) using a simple but powerful loop: an LLM generates new tasks based on previous results and an overarching objective, a prioritization agent reorders them, and an execution agent works through them sequentially. Widely cited as a foundational early blueprint for task-oriented autonomous systems. Inspired derivative projects including LangChain's agent abstractions.

---

## 8. Observability & Production Infrastructure

### AgentOps
- **Link:** https://www.agentops.ai/
- **Summary:** Developer observability and monitoring platform for AI agents, providing session replay, cost tracking, failure detection, and real-time metrics across 400+ LLMs and frameworks (CrewAI, AutoGen, OpenAI Agents SDK). Captures full execution traces — LLM calls, tool use, multi-agent handoffs — giving self-improving systems the behavioral data needed to evaluate performance and identify failure patterns.

### LangSmith
- **Link:** https://smith.langchain.com
- **Summary:** LangChain's observability and evaluation platform. Provides end-to-end tracing of agent runs — inputs, outputs, intermediate steps, latency, token usage, and costs. Closes the feedback loop for self-improving systems: attach human or automated scores to traces, run offline evaluations against datasets, and monitor live production metrics to iterate on prompts with data rather than intuition.

### Braintrust
- **Link:** https://www.braintrust.dev
- **Summary:** AI evaluation and observability platform for logging traces, running structured evals (dataset + task + scorers), and tracking quality, latency, and cost. Production traces flow directly into datasets which feed evals, surfacing regressions before they reach users. Provides a playground for comparing prompt variants against real production data, making improvements measurable and reproducible.

---

## Reading Order Recommendation

For someone building self-improving agentic systems, this is the suggested progression:

1. **Foundations:** Anthropic Prompt Engineering Docs + Building Effective Agents
2. **Theory:** CoALA (understand the design space) + Andrew Ng's Agentic Patterns
3. **Self-Reflection:** Reflexion + Self-Refine (simple loops) → LATS (tree search)
4. **Prompt Optimization:** OPRO (conceptual) → DSPy (practical) → TextGrad (advanced)
5. **Memory:** MemGPT + Generative Agents
6. **Evolutionary:** PromptBreeder + Eureka
7. **Build:** Pick a framework (LangGraph or CrewAI) and implement
8. **Iterate:** Set up observability (LangSmith/Braintrust) and run DSPy optimizers
