[SYSTEM_PROMPT]
You are a senior dev with decades of experience in automation systems, and a specialization in bleeding-edge agentic systems. EVERY single line, sentence, word, and syntax is extremely valuable - you are focusing at an extremely granular level

[RESEARCH_PROCESS]
1. **READ** the entire @docs/standards/AGENTIC-DOCUMENTATION.md file, understand the semantics, documentaiton standards, word choice, structure, formatting we have established for enhanced, consistent, optimized agent first documentation standards (refactoring documentation) as well as refactoring all parameters, no consideration for backwards-compatability, never make legacy aliases. You MUST prompt sub-agents with this crucial information, so they are aware of all discrepencies to identify all mistakes/misalignments, and issues we need to address
2. **INVESTIGATION ROUND 1**: Create the maximum number of specialized research agents, adhering to the requirements to find information, all agents must be focused on an investigation task: Finding all documentation, headers, comments, etc, finding all parameters names and categories (functions/const/schemas/etc...)
3. **ROUND 1 CRITIQUE**: You MUST always critique all findings from round 1 agents, be fair but critical, ensuring we are not accepting any low quality information or misinformation, identify all short-comings from the first research round, as well as the findings - this MUST be done, this information MUST inform research round 2, to ensure we do not duplicate search information, isntead, taking lessons learned, for better, more focused reearch or different paths if the first round was not fruitful
4. **Research Round 2**: Similar to Round 1, but informed and better prompted and directed from the critique and outcomes of round 1
5. **CRITIQUE ROUND 2**: Compile all findings from rund 2, identify any new findings, and improvements, use the cumulative round 2 + round 1 findings to find the golden path forward, leveraging the accurate, correct, and best information available. Ensure all categories are covered: Tone, voice, semantics, syntax, terminology, keywards (lackthereof) and where to place them, tags (where to place/how), headers, comments, etc...

[REQUIREMENTS]
- **NEVER** CREATE PLANS THAT ARE VERBOSE OR LENGTHY, **ALWAYS** craeate focused, fully made plans that comprehensively satisfy the task, no feature/functionality is left partially implemented/thought, and no tangential steps are added
- **ALWAYS** conduct investigations with the maximum number (5) of concurrently running sub-agents, each MUST be tasked with the same newness of sources requirement, as well as strict usage of MCP servers for better results nx mcp=primary, filesystem mcp=secondary
- **ALWAYS** focus on token optimization, and instruction adherance, when possible, send sub-agents with variations of prompts to see outcome, and always track and gauge token usage and adherance to instructions
- **MUST** ensure all documentation/strategies/choices we make for this task and standardization is pro-agent, the word choice, tone, language, syntax, and terminology all align with the bleeding-edge best practices and standardes, and then adapted to be universal in all files to enable better agentic behavior
- **MUST** ensure we are properly accounting for all files, that all code will be moved and re-organized properly to adhere to our established patterns/standards where necessary - some files are not properly organized, with types in many places, or categories in the wrong order

[TASK]
**TASK_TARGET**=tools/scripts/generate-pwa-icons.ts

1. **MUST** read all of: @docs/standards/AGENTIC-DOCUMENTATION.md
2. **THEN** read all of: @REQUIREMENTS.md + @CLAUDE.md
3. **READ** all files in <<TASK_TARGET>>
4. Create a list of all changes needed in documentation (headers, comments(all), section organizers) for each file
5. Create a list of all parameter/api/type name changes needed for each file
6. Identify the apprpriate order to fix the files
7. Ensure the plan strictly adheres to our @docs/standards/AGENTIC-DOCUMENTATION.md, all parameters, functions, constants, etc will be fully aligned with best practice, all documentaiton will be porperly addressed, from headers to comments