/**
 * OpenClaw before_prompt_build event structure dumper
 */
module.exports = {
  id: 'skill-wall-test',
  name: 'Skill Wall Event Structure Test',
  register(api) {
    api.on('before_prompt_build', async (event) => {
      const output = {
        eventKeys: Object.keys(event),
        contextKeys: event.context ? Object.keys(event.context) : null,
        hasBootstrapFiles: Array.isArray(event.bootstrapFiles),
        hasSystemPrompt: !!event.systemPrompt,
        hasPrependContext: !!event.prependContext,
        sampleKeys: {}
      };
      if (event.context) {
        for (const key of Object.keys(event.context)) {
          const val = event.context[key];
          if (typeof val === 'string') output.sampleKeys[key] = val.slice(0, 100);
          else if (typeof val === 'object') output.sampleKeys[key] = '[object]';
          else output.sampleKeys[key] = String(val);
        }
      }
      console.log('EVENT_STRUCTURE:' + JSON.stringify(output));
    });
  }
};