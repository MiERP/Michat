<script lang="ts">
  import {
    listFetchProviders,
    listImageSearchProviders,
    listSearchProviders,
    loadSavedConfig,
    loadWebConfig,
    saveConfig,
    saveWebConfig,
    THINKING_LEVELS,
    type ThinkingLevel,
  } from "@office-agents/sdk";
  import {
    Check,
    ChevronDown,
    ChevronUp,
    FolderUp,
    Plus,
    Trash2,
  } from "lucide-svelte";
  import { getChatContext } from "./chat-runtime-context";

  const chat = getChatContext();
  const runtimeState = chat.state;
  const adapter = chat.adapter;
  const ns = chat.context.namespace;

  let folderInputRef = $state<HTMLInputElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let installing = $state(false);

  const saved = loadSavedConfig(ns);
  let thinking = $state<ThinkingLevel>(saved.thinking);

  const savedWeb = loadWebConfig(ns);
  let webSearchProvider = $state(savedWeb.searchProvider);
  let imageSearchProvider = $state(savedWeb.imageSearchProvider);
  let webFetchProvider = $state(savedWeb.fetchProvider);
  let braveApiKey = $state(savedWeb.apiKeys.brave || "");
  let serperApiKey = $state(savedWeb.apiKeys.serper || "");
  let exaApiKey = $state(savedWeb.apiKeys.exa || "");
  let showAdvancedWebKeys = $state(false);

  const expandToolCalls = $derived(
    $runtimeState.providerConfig?.expandToolCalls ?? false,
  );
  const searchProviders = listSearchProviders();
  const imageSearchProviders = listImageSearchProviders();
  const fetchProviders = listFetchProviders();
  const needsBraveKey = $derived(webSearchProvider === "brave");
  const needsSerperKey = $derived(
    webSearchProvider === "serper" ||
      (adapter.hasImageSearch && imageSearchProvider === "serper"),
  );
  const needsExaKey = $derived(
    webSearchProvider === "exa" || webFetchProvider === "exa",
  );

  const inputStyle =
    "border-radius: var(--chat-radius); font-family: var(--chat-font-mono)";

  function updateThinking(nextThinking: ThinkingLevel) {
    thinking = nextThinking;
    const config = { ...loadSavedConfig(ns), thinking: nextThinking };
    saveConfig(ns, config);
    chat.setProviderConfig(config);
  }

  function updateWebSettings(
    updates: Partial<{
      searchProvider: string;
      imageSearchProvider: string;
      fetchProvider: string;
      braveApiKey: string;
      serperApiKey: string;
      exaApiKey: string;
    }>,
  ) {
    webSearchProvider = updates.searchProvider ?? webSearchProvider;
    imageSearchProvider =
      updates.imageSearchProvider ?? imageSearchProvider;
    webFetchProvider = updates.fetchProvider ?? webFetchProvider;
    braveApiKey = updates.braveApiKey ?? braveApiKey;
    serperApiKey = updates.serperApiKey ?? serperApiKey;
    exaApiKey = updates.exaApiKey ?? exaApiKey;

    saveWebConfig(ns, {
      searchProvider: webSearchProvider,
      imageSearchProvider,
      fetchProvider: webFetchProvider,
      apiKeys: {
        brave: braveApiKey,
        serper: serperApiKey,
        exa: exaApiKey,
      },
    });
  }

  async function handleFolderSelect(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    installing = true;
    try {
      await chat.installSkill(Array.from(files));
    } finally {
      installing = false;
      if (folderInputRef) folderInputRef.value = "";
    }
  }

  async function handleFileSelect(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    installing = true;
    try {
      await chat.installSkill(Array.from(files));
    } finally {
      installing = false;
      if (fileInputRef) fileInputRef.value = "";
    }
  }
</script>

{#snippet toggleSwitch(active: boolean, onclick: () => void, ariaLabel: string)}
  <button
    type="button"
    {onclick}
    aria-label={ariaLabel}
    class={`w-10 h-5 rounded-full transition-colors relative ${active ? "bg-(--chat-accent)" : "bg-(--chat-border)"}`}
  >
    <span
      class={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${active ? "left-5" : "left-0.5"}`}
    ></span>
  </button>
{/snippet}

{#snippet apiKeyField(label: string, value: string, onInput: (v: string) => void, placeholder: string, altBg?: boolean)}
  <label class="block">
    <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
      {label}
    </span>
    <input
      type="password"
      {value}
      oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      {placeholder}
      class={`w-full text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active) ${altBg ? "bg-(--chat-bg)" : "bg-(--chat-input-bg)"}`}
      style={inputStyle}
    />
  </label>
{/snippet}

<div class="flex-1 overflow-y-auto p-4 space-y-6" style="font-family: var(--chat-font-mono)">
  <div>
    <div class="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-4">
      MiChat local model
    </div>
    <div class="space-y-4">
      <div class="flex items-center gap-2 text-xs border border-(--chat-border) bg-(--chat-input-bg) px-3 py-2" style="border-radius: var(--chat-radius)">
        <Check size={12} class="text-(--chat-success)" />
        <span class="text-(--chat-text-secondary)">Connected through localhost MiChat provider</span>
      </div>
      <div>
        <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
          Thinking Level
        </span>
        <div class="flex gap-1">
          {#each THINKING_LEVELS as level (level.value)}
            <button
              type="button"
              onclick={() => updateThinking(level.value)}
              class={`flex-1 py-1.5 text-xs border transition-colors ${thinking === level.value ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              {level.label}
            </button>
          {/each}
        </div>
        <p class="text-[10px] text-(--chat-text-muted) mt-1">
          Extended thinking for supported models
        </p>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs text-(--chat-text-secondary)">
            Expand Tool Calls
          </span>
          <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
            Show tool call details expanded by default
          </p>
        </div>
        {@render toggleSwitch(
          expandToolCalls,
          () => chat.toggleExpandToolCalls(),
          expandToolCalls ? "Collapse tool calls by default" : "Expand tool calls by default",
        )}
      </div>

      <div class="border-t border-(--chat-border) pt-4 space-y-3">
        <div class="text-[10px] uppercase tracking-widest text-(--chat-text-muted)">
          web tools
        </div>

        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Default Search Provider
          </span>
          <select
            value={webSearchProvider}
            onchange={(event) =>
              updateWebSettings({
                searchProvider: (event.currentTarget as HTMLSelectElement).value,
              })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          >
            {#each searchProviders as searchProvider (searchProvider.id)}
              <option value={searchProvider.id}>{searchProvider.label}</option>
            {/each}
          </select>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Used by web-search.
          </p>
        </label>

        {#if adapter.hasImageSearch}
          <label class="block">
            <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
              Default Image Search Provider
            </span>
            <select
              value={imageSearchProvider}
              onchange={(event) =>
                updateWebSettings({
                  imageSearchProvider:
                    (event.currentTarget as HTMLSelectElement).value,
                })}
              class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            >
              {#each imageSearchProviders as imageProvider (imageProvider.id)}
                <option value={imageProvider.id}>{imageProvider.label}</option>
              {/each}
            </select>
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              Used by image-search.
            </p>
          </label>
        {/if}

        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Default Fetch Provider
          </span>
          <select
            value={webFetchProvider}
            onchange={(event) =>
              updateWebSettings({
                fetchProvider: (event.currentTarget as HTMLSelectElement).value,
              })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          >
            {#each fetchProviders as fetchProvider (fetchProvider)}
              <option value={fetchProvider}>{fetchProvider}</option>
            {/each}
          </select>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Used by web-fetch.
          </p>
        </label>

        {#if needsBraveKey}
          {@render apiKeyField("Brave API Key", braveApiKey, (v) => { braveApiKey = v; updateWebSettings({ braveApiKey }); }, "Required for Brave search")}
        {/if}

        {#if needsSerperKey}
          {@render apiKeyField("Serper API Key", serperApiKey, (v) => { serperApiKey = v; updateWebSettings({ serperApiKey }); }, "Required for Serper search")}
        {/if}

        {#if needsExaKey}
          {@render apiKeyField("Exa API Key", exaApiKey, (v) => { exaApiKey = v; updateWebSettings({ exaApiKey }); }, "Required for Exa search/fetch")}
        {/if}

        <div class="pt-1">
          <button
            type="button"
            onclick={() => (showAdvancedWebKeys = !showAdvancedWebKeys)}
            class="inline-flex items-center gap-1.5 text-xs text-(--chat-text-secondary) hover:text-(--chat-text-primary)"
          >
            {#if showAdvancedWebKeys}
              <ChevronUp size={12} />
            {:else}
              <ChevronDown size={12} />
            {/if}
            <span>
              {showAdvancedWebKeys ? "Hide" : "Show"} advanced saved API keys
            </span>
          </button>
        </div>

        {#if showAdvancedWebKeys}
          <div class="space-y-3 border border-(--chat-border) p-3 bg-(--chat-input-bg)">
            {#if !needsBraveKey}
              {@render apiKeyField("Brave API Key", braveApiKey, (v) => { braveApiKey = v; updateWebSettings({ braveApiKey }); }, "Optional", true)}
            {/if}

            {#if !needsSerperKey}
              {@render apiKeyField("Serper API Key", serperApiKey, (v) => { serperApiKey = v; updateWebSettings({ serperApiKey }); }, "Optional", true)}
            {/if}

            {#if !needsExaKey}
              {@render apiKeyField("Exa API Key", exaApiKey, (v) => { exaApiKey = v; updateWebSettings({ exaApiKey }); }, "Optional", true)}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="border-t border-(--chat-border) pt-4">
    <div class="flex items-center gap-2 text-xs">
      <Check size={12} class="text-(--chat-success)" />
      <span class="text-(--chat-text-secondary)">Using MiChat local model</span>
    </div>
  </div>

  <div class="border-t border-(--chat-border) pt-4">
    <div class="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-4">
      agent skills
    </div>

    <div class="space-y-3">
      {#if $runtimeState.skills.length > 0}
        <div class="space-y-1">
          {#each $runtimeState.skills as skill (skill.name)}
            <div
              class="flex items-start justify-between gap-2 px-3 py-2 bg-(--chat-input-bg) border border-(--chat-border)"
              style="border-radius: var(--chat-radius)"
            >
              <div class="min-w-0 flex-1">
                <div class="text-xs text-(--chat-text-primary) font-medium truncate">
                  {skill.name}
                </div>
                <div class="text-[10px] text-(--chat-text-muted) mt-0.5 line-clamp-2">
                  {skill.description}
                </div>
              </div>
              <button
                type="button"
                onclick={() => chat.uninstallSkill(skill.name)}
                class="shrink-0 p-1 text-(--chat-text-muted) hover:text-(--chat-error) transition-colors"
                title="Remove skill"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-(--chat-text-muted)">No skills installed</p>
      {/if}

      <div class="flex gap-2">
        <button
          type="button"
          onclick={() => folderInputRef?.click()}
          disabled={installing}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) hover:text-(--chat-text-primary) disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style="border-radius: var(--chat-radius)"
        >
          <FolderUp size={12} />
          {installing ? "Installing…" : "Add Folder"}
        </button>
        <button
          type="button"
          onclick={() => fileInputRef?.click()}
          disabled={installing}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) hover:text-(--chat-text-primary) disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style="border-radius: var(--chat-radius)"
        >
          <Plus size={12} />
          {installing ? "Installing…" : "Add File"}
        </button>
      </div>

      <p class="text-[10px] text-(--chat-text-muted)">
        Add a skill folder or a single SKILL.md file. Skills must have valid
        frontmatter with name and description.
      </p>
    </div>

    <input
      bind:this={folderInputRef}
      type="file"
      class="hidden"
      webkitdirectory={true}
      multiple
      onchange={handleFolderSelect}
    />
    <input
      bind:this={fileInputRef}
      type="file"
      accept=".md"
      class="hidden"
      onchange={handleFileSelect}
    />
  </div>

  <div class="border-t border-(--chat-border) pt-4">
    <div class="text-[10px] uppercase tracking-widest text-(--chat-text-muted) mb-2">
      about
    </div>
    <p class="text-xs text-(--chat-text-secondary) leading-relaxed">
      {adapter.appName || "This app"} uses MiChat local model through the localhost bridge. No cloud LLM provider or API key is used.
    </p>
    <p class="text-[10px] text-(--chat-text-muted) mt-3">
      {adapter.appVersion ? `v${adapter.appVersion}` : ""}
    </p>
  </div>
</div>

