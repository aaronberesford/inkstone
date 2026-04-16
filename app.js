(function () {
  const STORAGE_KEY = "inkstone-imports-v1";
  const DEFAULT_CEDICT_PATH = "assets/data/cedict_runtime.json";
  const DEFAULT_TATOEBA_PATH = "assets/data/tatoeba_runtime.json";
  const DEFAULT_HSK_PATH = "assets/data/hsk_words.json";
  const MAX_AUTO_CEDICT_ENTRIES = 40000;
  const MAX_AUTO_SENTENCE_ENTRIES = 12000;
  const MAX_LOCAL_VOCAB_PERSIST = 250;
  const MAX_LOCAL_SENTENCE_PERSIST = 500;
  const SEARCH_DEBOUNCE_MS = 90;
  const baseData = cloneData(window.CHINESE_APP_DATA || { vocab: [], sentences: [], dailyChallenge: {} });
  const importedData = loadImportedData();
  let searchDebounceId = 0;
  let activeStrokeCharacter = "";
  let strokeWriter = null;
  let sentencePreviewEl = null;

  const initialVocab = preprocessVocabEntries(mergeById(baseData.vocab, importedData.vocab));
  const state = {
    vocab: initialVocab,
    termIndex: buildTermIndex(initialVocab),
    sentences: preprocessSentenceEntries(mergeById(baseData.sentences, importedData.sentences)),
    selectedLevel: "All",
    search: "",
    selectedTermId: baseData.vocab[0] ? baseData.vocab[0].id : null,
    currentCardId: baseData.vocab[0] ? baseData.vocab[0].id : null,
    revealCard: false,
    hskOnly: false,
    hskLookup: {},
    cardsReviewed: 0,
    accuracy: 82,
    streak: 9,
    sessionGoal: 18,
    masteredWords: [],
    importSummary: importedData.summary || "Waiting for your first dictionary file."
  };

  const elements = {
    cardsReviewed: document.getElementById("cards-reviewed"),
    streakCount: document.getElementById("streak-count"),
    accuracyRate: document.getElementById("accuracy-rate"),
    progressPercent: document.getElementById("progress-percent"),
    progressMeterFill: document.getElementById("progress-meter-fill"),
    sessionGoal: document.getElementById("session-goal"),
    masteredCount: document.getElementById("mastered-count"),
    learnedList: document.getElementById("learned-list"),
    challengeTitle: document.getElementById("challenge-title"),
    challengeText: document.getElementById("challenge-text"),
    challengeWord: document.getElementById("challenge-word"),
    hskOnlyToggle: document.getElementById("hsk-only-toggle"),
    levelFilter: document.getElementById("level-filter"),
    cardTitle: document.getElementById("card-title"),
    cardFace: document.getElementById("card-face"),
    cardCharacter: document.getElementById("card-character"),
    cardPinyin: document.getElementById("card-pinyin"),
    cardTranslation: document.getElementById("card-translation"),
    cardMemory: document.getElementById("card-memory"),
    cardSpeak: document.getElementById("card-speak"),
    revealCard: document.getElementById("reveal-card"),
    sentenceCount: document.getElementById("sentence-count"),
    sentenceStack: document.getElementById("sentence-stack"),
    hanziBreakdown: document.getElementById("hanzi-breakdown"),
    search: document.getElementById("dictionary-search"),
    resultsList: document.getElementById("results-list"),
    inspectorHeadword: document.getElementById("inspector-headword"),
    inspectorLevel: document.getElementById("inspector-level"),
    inspectorPinyin: document.getElementById("inspector-pinyin"),
    inspectorDefinition: document.getElementById("inspector-definition"),
    inspectorMemory: document.getElementById("inspector-memory"),
    inspectorSpeak: document.getElementById("inspector-speak"),
    strokeReplay: document.getElementById("stroke-replay"),
    strokeCharacterTabs: document.getElementById("stroke-character-tabs"),
    strokeStage: document.getElementById("stroke-stage"),
    strokeStatus: document.getElementById("stroke-status"),
    importStatus: document.getElementById("import-status"),
    cedictFile: document.getElementById("cedict-file"),
    sentencesFile: document.getElementById("sentences-file")
  };

  init();

  function init() {
    applyDailyChallenge();
    bindEvents();
    render();
    autoLoadBundledAssets();
  }

  function bindEvents() {
    elements.revealCard.addEventListener("click", function () {
      state.revealCard = !state.revealCard;
      renderCard();
    });

    elements.cardSpeak.addEventListener("click", function () {
      const term = getSelectedTerm();
      if (term) {
        speakMandarin(term.simplified);
      }
    });

    elements.inspectorSpeak.addEventListener("click", function () {
      const term = getSelectedTerm();
      if (term) {
        speakMandarin(term.simplified);
      }
    });

    elements.strokeReplay.addEventListener("click", function () {
      replayStrokeAnimation();
    });

    elements.levelFilter.addEventListener("click", function (event) {
      const target = event.target.closest("[data-level]");
      if (!target) {
        return;
      }

      state.selectedLevel = target.dataset.level;
      state.currentCardId = getDeck()[0] ? getDeck()[0].id : null;
      state.selectedTermId = state.currentCardId || (getFilteredVocab()[0] ? getFilteredVocab()[0].id : null);
      state.revealCard = false;
      render();
    });

    document.addEventListener("click", function (event) {
      const scoreButton = event.target.closest("[data-score]");
      if (scoreButton) {
        gradeCard(scoreButton.dataset.score);
        return;
      }

      const resultItem = event.target.closest("[data-term-id]");
      if (resultItem && resultItem.classList.contains("result-item")) {
        activateTerm(resultItem.dataset.termId, false);
        render();
        return;
      }

      const sentenceToken = event.target.closest("[data-sentence-term-id]");
      if (sentenceToken) {
        activateTerm(sentenceToken.dataset.sentenceTermId, true);
        render();
        return;
      }

      const speakButton = event.target.closest("[data-speak-text]");
      if (speakButton) {
        speakMandarin(speakButton.dataset.speakText);
        return;
      }

      const strokeChip = event.target.closest("[data-stroke-char]");
      if (strokeChip) {
        setActiveStrokeCharacter(strokeChip.dataset.strokeChar);
      }
    });

    document.addEventListener("mouseover", function (event) {
      const sentenceToken = event.target.closest("[data-sentence-term-id]");
      if (!sentenceToken) {
        return;
      }

      showSentencePreview(sentenceToken.dataset.sentenceTermId, event.clientX, event.clientY);
    });

    document.addEventListener("mousemove", function (event) {
      if (!sentencePreviewEl || sentencePreviewEl.hidden) {
        return;
      }

      moveSentencePreview(event.clientX, event.clientY);
    });

    document.addEventListener("mouseout", function (event) {
      const sentenceToken = event.target.closest("[data-sentence-term-id]");
      if (!sentenceToken) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (relatedTarget && sentenceToken.contains(relatedTarget)) {
        return;
      }

      hideSentencePreview();
    });

    document.addEventListener("focusin", function (event) {
      const sentenceToken = event.target.closest("[data-sentence-term-id]");
      if (!sentenceToken) {
        return;
      }

      const rect = sentenceToken.getBoundingClientRect();
      showSentencePreview(
        sentenceToken.dataset.sentenceTermId,
        rect.left + (rect.width / 2),
        rect.top
      );
    });

    document.addEventListener("focusout", function (event) {
      if (event.target.closest("[data-sentence-term-id]")) {
        hideSentencePreview();
      }
    });

    elements.search.addEventListener("input", function (event) {
      const nextSearch = event.target.value.trim();
      clearTimeout(searchDebounceId);
      searchDebounceId = setTimeout(function () {
        state.search = nextSearch;
        syncSelectionToMatches();
        renderSearchViews();
      }, SEARCH_DEBOUNCE_MS);
    });

    elements.cedictFile.addEventListener("change", function (event) {
      handleCedictImport(event.target.files && event.target.files[0]);
    });

    elements.sentencesFile.addEventListener("change", function (event) {
      handleSentenceImport(event.target.files && event.target.files[0]);
    });

    elements.hskOnlyToggle.addEventListener("change", function (event) {
      state.hskOnly = event.target.checked;
      const matches = getFilteredVocab();
      if (matches.length > 0) {
        state.selectedTermId = matches[0].id;
        state.currentCardId = matches[0].id;
      }
      state.revealCard = false;
      render();
    });
  }

  function syncSelectionToMatches() {
    const matches = getFilteredVocab();
    if (matches.length > 0) {
      state.selectedTermId = matches[0].id;
      if (!findTermById(state.currentCardId) || !matches.some(function (item) { return item.id === state.currentCardId; })) {
        state.currentCardId = matches[0].id;
        state.revealCard = false;
      }
    }
  }

  function activateTerm(termId, syncSearch) {
    const term = findTermById(termId);
    if (!term) {
      return;
    }

    state.selectedTermId = term.id;
    state.currentCardId = term.id;
    state.revealCard = false;

    if (syncSearch) {
      state.search = term.simplified || "";
      elements.search.value = state.search;
    }

    hideSentencePreview();
  }

  function renderSearchViews() {
    renderCard();
    renderResults();
    renderInspector();
    renderSentences();
    renderBreakdown();
  }

  function render() {
    renderStats();
    renderSessionProgress();
    renderSearchFilters();
    renderLevelFilter();
    renderCard();
    renderResults();
    renderInspector();
    renderSentences();
    renderBreakdown();
    renderImportStatus();
  }

  function renderStats() {
    elements.cardsReviewed.textContent = String(state.cardsReviewed);
    elements.streakCount.textContent = state.streak + " days";
    elements.accuracyRate.textContent = state.accuracy + "%";
  }

  function renderSessionProgress() {
    const percent = Math.min(100, Math.round((state.cardsReviewed / state.sessionGoal) * 100));
    elements.progressPercent.textContent = percent + "%";
    elements.progressMeterFill.style.width = percent + "%";
    elements.sessionGoal.textContent = state.sessionGoal + " cards";
    elements.masteredCount.textContent = state.masteredWords.length + (state.masteredWords.length === 1 ? " word" : " words");
    elements.learnedList.innerHTML = "";

    if (state.masteredWords.length === 0) {
      elements.learnedList.innerHTML = '<p class="learned-empty">High-confidence reviews will start collecting here as you work through the queue.</p>';
      return;
    }

    state.masteredWords.slice(-6).reverse().forEach(function (term) {
      const item = document.createElement("div");
      item.className = "learned-pill";
      item.innerHTML = [
        "<strong>" + escapeHtml(term.simplified) + "</strong>",
        "<span>" + escapeHtml(term.pinyin) + "</span>"
      ].join("");
      elements.learnedList.appendChild(item);
    });
  }

  function renderLevelFilter() {
    Array.prototype.forEach.call(elements.levelFilter.querySelectorAll("[data-level]"), function (button) {
      button.classList.toggle("active", button.dataset.level === state.selectedLevel);
    });
  }

  function renderCard() {
    const deck = getDeck();
    const currentCard = findTermById(state.currentCardId) || deck[0] || getFilteredVocab()[0];

    if (!currentCard) {
      elements.cardTitle.textContent = "No word selected";
      elements.cardCharacter.textContent = "Load data";
      elements.cardPinyin.textContent = "dictionary pending";
      elements.cardTranslation.textContent = "Import vocabulary to begin.";
      elements.cardMemory.textContent = "Search for a word and the stroke studio will update as soon as a lexicon is available.";
      elements.cardFace.classList.remove("is-hidden");
      return;
    }

    state.currentCardId = currentCard.id;
    if (!state.selectedTermId) {
      state.selectedTermId = currentCard.id;
    }

    elements.cardTitle.textContent = currentCard.simplified;
    elements.cardCharacter.textContent = currentCard.simplified;
    elements.cardPinyin.textContent = currentCard.pinyin;
    elements.cardTranslation.textContent = currentCard.english;
    elements.cardMemory.textContent = currentCard.memory;
    elements.revealCard.textContent = state.revealCard ? "Hide notes" : "Reveal notes";
    elements.cardFace.classList.toggle("is-hidden", !state.revealCard);
  }

  function renderResults() {
    const matches = getFilteredVocab();
    elements.resultsList.innerHTML = "";

    if (matches.length === 0) {
      elements.resultsList.innerHTML = '<p class="result-definition">No matches yet. Try a different search or import more data.</p>';
      return;
    }

    if (normalizeSearchText(state.search).length === 0) {
      renderResultSection("", matches.slice(0, 12));
      return;
    }

    const sections = splitSearchResults(matches, normalizeSearchText(state.search));
    renderResultSection("Core Vocabulary", sections.core);
    renderResultSection("Extended Phrases", sections.extended);
    renderResultSection("Hidden / Rare", sections.hidden);
  }

  function renderSearchFilters() {
    elements.hskOnlyToggle.checked = state.hskOnly;
  }

  function renderResultSection(title, terms) {
    if (terms.length === 0) {
      return;
    }

    const section = document.createElement("section");
    section.className = "result-section";

    if (title) {
      const heading = document.createElement("p");
      heading.className = "result-section-title";
      heading.textContent = title;
      section.appendChild(heading);
    }

    terms.forEach(function (term) {
      const hskBadge = getHskBadge(term);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-item" + (term.id === state.selectedTermId ? " active" : "");
      button.dataset.termId = term.id;
      button.innerHTML = [
        '<div class="result-head">',
        '<span class="result-hanzi">' + escapeHtml(term.simplified) + "</span>",
        '<span class="result-meta-tags">' +
          (hskBadge ? '<span class="result-badge result-badge-hsk">' + escapeHtml(hskBadge) + "</span>" : "") +
          '<span class="tiny-label">' + escapeHtml(getDisplayLevel(term)) + "</span>" +
        "</span>",
        "</div>",
        '<p class="result-meta">' + escapeHtml(term.pinyin) + "</p>",
        '<p class="result-definition">' + escapeHtml(term.english) + "</p>"
      ].join("");
      section.appendChild(button);
    });

    elements.resultsList.appendChild(section);
  }

  function splitSearchResults(matches, normalizedSearch) {
    const core = [];
    const extended = [];
    const hidden = [];

    matches.slice(0, 24).forEach(function (term) {
      const rank = rankSearchMatch(term, normalizedSearch);
      const isCoreWord = rank <= 4 && (term.simplified || "").length <= 3;
      const isHiddenRare = isRareTerm(term);

      if (isHiddenRare) {
        hidden.push(term);
        return;
      }

      if (isCoreWord) {
        core.push(term);
      } else {
        extended.push(term);
      }
    });

    core.sort(function (left, right) {
      return compareSearchRank(left, right, normalizedSearch);
    });
    extended.sort(function (left, right) {
      return compareSearchRank(left, right, normalizedSearch);
    });
    hidden.sort(function (left, right) {
      return compareSearchRank(left, right, normalizedSearch);
    });

    if (core.length === 0 && extended.length > 0) {
      core.push(extended.shift());
    }

    return {
      core: core.slice(0, 8),
      extended: extended.slice(0, 8),
      hidden: hidden.slice(0, 6)
    };
  }

  function renderInspector() {
    const term = getSelectedTerm();
    if (!term) {
      return;
    }

    elements.inspectorHeadword.textContent = term.simplified;
    elements.inspectorLevel.textContent = getDisplayLevel(term);
    elements.inspectorPinyin.textContent = term.pinyin;
    elements.inspectorDefinition.textContent = term.english;
    elements.inspectorMemory.textContent = term.memory;
    renderStrokePanel(term);
  }

  function renderSentences() {
    const term = getSelectedTerm();
    const relatedSentences = term ? getSentencesForTerm(term) : [];
    elements.sentenceCount.textContent = relatedSentences.length + (relatedSentences.length === 1 ? " example" : " examples");
    elements.sentenceStack.innerHTML = "";

    if (relatedSentences.length === 0) {
      elements.sentenceStack.innerHTML = '<p class="result-definition">Import a sentence file to expand this context panel.</p>';
      return;
    }

    relatedSentences.slice(0, 4).forEach(function (sentence) {
      const wrapper = document.createElement("article");
      wrapper.className = "sentence-item";
      wrapper.innerHTML = [
        '<p class="sentence-hanzi">' + renderInteractiveSentence(sentence) + "</p>",
        sentence.pinyin ? '<p class="sentence-pinyin">' + escapeHtml(sentence.pinyin) + "</p>" : "",
        sentence.en ? '<p class="sentence-english">' + escapeHtml(sentence.en) + "</p>" : '<p class="sentence-english">No English gloss attached yet.</p>',
        '<div class="sentence-actions"><button class="ghost-button ghost-button-small" type="button" data-speak-text="' + escapeHtml(sentence.zh) + '">Play sentence</button></div>'
      ].join("");
      elements.sentenceStack.appendChild(wrapper);
    });
  }

  function renderBreakdown() {
    const term = getSelectedTerm();
    elements.hanziBreakdown.innerHTML = "";

    if (!term || !term.parts || term.parts.length === 0) {
      elements.hanziBreakdown.innerHTML = '<p class="result-definition">Character notes will appear here once a card is selected.</p>';
      return;
    }

    term.parts.forEach(function (part) {
      const row = document.createElement("div");
      row.className = "hanzi-part";
      row.innerHTML = [
        "<strong>" + escapeHtml(part.hanzi) + "</strong>",
        "<p>" + escapeHtml(part.note) + "</p>"
      ].join("");
      elements.hanziBreakdown.appendChild(row);
    });
  }

  function renderImportStatus() {
    elements.importStatus.textContent = state.importSummary;
  }

  function speakMandarin(text) {
    if (!text || !window.speechSynthesis) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(function (voice) {
      return /^zh/i.test(voice.lang || "") && /CN|Hans/i.test(voice.lang || "");
    }) || voices.find(function (voice) {
      return /^zh/i.test(voice.lang || "");
    });

    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    } else {
      utterance.lang = "zh-CN";
    }

    utterance.rate = 0.92;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function gradeCard(score) {
    const adjustments = {
      again: -6,
      hard: -1,
      good: 2,
      easy: 4
    };
    const adjustment = adjustments[score] || 0;

    const reviewedTerm = findTermById(state.currentCardId);

    state.cardsReviewed += 1;
    state.accuracy = clamp(state.accuracy + adjustment, 55, 99);
    state.revealCard = false;

    if ((score === "good" || score === "easy") && reviewedTerm) {
      rememberMasteredWord(reviewedTerm);
    }

    const deck = getDeck();
    if (deck.length === 0) {
      render();
      return;
    }

    const currentIndex = deck.findIndex(function (term) {
      return term.id === state.currentCardId;
    });
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % deck.length : 0;
    state.currentCardId = deck[nextIndex].id;
    state.selectedTermId = state.currentCardId;
    render();
  }

  function rememberMasteredWord(term) {
    if (state.masteredWords.some(function (item) { return item.id === term.id; })) {
      return;
    }

    state.masteredWords.push({
      id: term.id,
      simplified: term.simplified,
      pinyin: term.pinyin
    });

    if (state.masteredWords.length > 12) {
      state.masteredWords = state.masteredWords.slice(-12);
    }
  }

  function getSelectedTerm() {
    return findTermById(state.selectedTermId) || getFilteredVocab()[0] || null;
  }

  function getDeck() {
    return getFilteredVocab().slice(0, 8);
  }

  function getFilteredVocab() {
    const normalizedSearch = normalizeSearchText(state.search);
    const filtered = state.vocab.filter(function (term) {
      const matchesLevel = state.selectedLevel === "All" || getDisplayLevel(term) === state.selectedLevel;
      const matchesHskOnly = !state.hskOnly || Boolean(getHskLevel(term));
      const matchesSearch = normalizedSearch.length === 0 || termMatchesSearch(term, normalizedSearch);
      return matchesLevel && matchesHskOnly && matchesSearch;
    });

    if (normalizedSearch.length === 0) {
      return filtered;
    }

    return filtered.sort(function (left, right) {
      return compareSearchRank(left, right, normalizedSearch);
    });
  }

  function getSentencesForTerm(term) {
    return state.sentences.filter(function (sentence) {
      const termIds = sentence.termIds || [];
      return (
        termIds.indexOf(term.id) !== -1 ||
        sentence.zh.indexOf(term.simplified) !== -1 ||
        (term.traditional && sentence.zh.indexOf(term.traditional) !== -1)
      );
    });
  }

  function findTermById(id) {
    return state.vocab.find(function (term) {
      return term.id === id;
    }) || null;
  }

  function renderInteractiveSentence(sentence) {
    const text = String(sentence.zh || "");
    const chunks = [];
    let index = 0;

    while (index < text.length) {
      const match = findSentenceMatch(text, index);
      if (match) {
        chunks.push([
          '<button class="sentence-token',
          match.term.id === state.selectedTermId ? ' active' : '',
          '" type="button" data-sentence-term-id="',
          escapeHtml(match.term.id),
          '">',
          escapeHtml(match.text),
          "</button>"
        ].join(""));
        index += match.text.length;
        continue;
      }

      chunks.push(escapeHtml(text.charAt(index)));
      index += 1;
    }

    return chunks.join("");
  }

  function findSentenceMatch(text, startIndex) {
    const maxLength = Math.min(6, text.length - startIndex);

    for (let length = maxLength; length >= 1; length -= 1) {
      const candidate = text.slice(startIndex, startIndex + length);
      if (!isPureHanzi(candidate)) {
        continue;
      }

      const term = findPreferredTermByText(candidate);
      if (term) {
        return {
          text: candidate,
          term: term
        };
      }
    }

    return null;
  }

  function findPreferredTermByText(text) {
    const matches = state.termIndex[normalizeHanziText(text)] || [];
    return matches[0] || null;
  }

  function getSentencePreviewElement() {
    if (sentencePreviewEl) {
      return sentencePreviewEl;
    }

    sentencePreviewEl = document.createElement("div");
    sentencePreviewEl.className = "sentence-tooltip";
    sentencePreviewEl.hidden = true;
    document.body.appendChild(sentencePreviewEl);
    return sentencePreviewEl;
  }

  function showSentencePreview(termId, clientX, clientY) {
    const term = findTermById(termId);
    if (!term) {
      hideSentencePreview();
      return;
    }

    const tooltip = getSentencePreviewElement();
    const level = getHskLevel(term);
    tooltip.innerHTML = [
      '<div class="sentence-tooltip-head">',
      '<strong>' + escapeHtml(term.simplified) + "</strong>",
      level ? '<span class="sentence-tooltip-badge">' + escapeHtml(level) + "</span>" : "",
      "</div>",
      '<p class="sentence-tooltip-pinyin">' + escapeHtml(term.pinyin || "Pinyin pending") + "</p>",
      '<p class="sentence-tooltip-definition">' + escapeHtml(term.english || "Definition pending") + "</p>"
    ].join("");
    tooltip.hidden = false;
    moveSentencePreview(clientX, clientY);
  }

  function moveSentencePreview(clientX, clientY) {
    const tooltip = getSentencePreviewElement();
    const offsetX = 16;
    const offsetY = 18;
    const maxLeft = Math.max(12, window.innerWidth - tooltip.offsetWidth - 12);
    const maxTop = Math.max(12, window.innerHeight - tooltip.offsetHeight - 12);
    const left = Math.min(maxLeft, clientX + offsetX);
    const top = Math.min(maxTop, clientY + offsetY);

    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  function hideSentencePreview() {
    if (!sentencePreviewEl) {
      return;
    }

    sentencePreviewEl.hidden = true;
  }

  function renderStrokePanel(term) {
    const characters = (term.simplified || "").split("").filter(containsHanzi);
    elements.strokeCharacterTabs.innerHTML = "";

    if (!characters.length) {
      elements.strokeStage.innerHTML = "";
      elements.strokeStatus.textContent = "Stroke animation is available when the selected term contains Hanzi.";
      return;
    }

    characters.forEach(function (char, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stroke-chip" + (char === activeStrokeCharacter || (!activeStrokeCharacter && index === 0) ? " active" : "");
      button.dataset.strokeChar = char;
      button.textContent = char;
      elements.strokeCharacterTabs.appendChild(button);
    });

    const nextChar = characters.indexOf(activeStrokeCharacter) !== -1 ? activeStrokeCharacter : characters[0];
    setActiveStrokeCharacter(nextChar);
  }

  function setActiveStrokeCharacter(char) {
    activeStrokeCharacter = char || "";
    Array.prototype.forEach.call(elements.strokeCharacterTabs.querySelectorAll("[data-stroke-char]"), function (button) {
      button.classList.toggle("active", button.dataset.strokeChar === activeStrokeCharacter);
    });
    loadStrokeAnimation(activeStrokeCharacter);
  }

  function loadStrokeAnimation(char) {
    if (!char) {
      return;
    }

    if (!window.HanziWriter) {
      elements.strokeStage.innerHTML = "";
      elements.strokeStatus.textContent = "Stroke animation support is unavailable right now.";
      return;
    }

    elements.strokeStage.innerHTML = '<div id="stroke-writer-target"></div>';
    elements.strokeStatus.textContent = "Drawing " + char + "...";
    strokeWriter = window.HanziWriter.create("stroke-writer-target", char, {
      width: 220,
      height: 220,
      padding: 10,
      strokeAnimationSpeed: 0.9,
      delayBetweenStrokes: 120,
      strokeColor: "#8f2f23",
      radicalColor: "#356857",
      outlineColor: "rgba(115, 97, 81, 0.18)"
    });

    strokeWriter.animateCharacter()
      .then(function () {
        elements.strokeStatus.textContent = "Stroke order ready for " + char + ".";
      })
      .catch(function () {
        elements.strokeStatus.textContent = "Stroke data is not available for " + char + " yet.";
      });
  }

  function replayStrokeAnimation() {
    if (strokeWriter && activeStrokeCharacter) {
      elements.strokeStatus.textContent = "Replaying " + activeStrokeCharacter + "...";
      strokeWriter.animateCharacter();
    }
  }

  function applyDailyChallenge() {
    const challenge = baseData.dailyChallenge || {};
    elements.challengeTitle.textContent = challenge.title || "Daily Challenge";
    elements.challengeText.textContent = challenge.text || "One sharp prompt to keep momentum going.";
    elements.challengeWord.textContent = challenge.word || "Culture";
  }

  function autoLoadBundledAssets() {
    if (window.location.protocol === "file:") {
      state.importSummary = "Bundled CEDICT, Tatoeba, and HSK data are ready in assets/data. To auto-load them on startup, serve this folder over a local web server instead of opening index.html directly.";
      renderImportStatus();
      return;
    }

    autoLoadBundledHsk()
      .catch(function () {
        return null;
      });

    autoLoadBundledCedict()
      .then(function (result) {
        if (!result || result.entries.length === 0) {
          return null;
        }
        return autoLoadBundledSentences();
      })
      .catch(function () {
        return null;
      });
  }

  function autoLoadBundledHsk() {
    return fetch(DEFAULT_HSK_PATH, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        state.hskLookup = payload && payload.lookup ? payload.lookup : {};
        render();
        return payload;
      });
  }

  function autoLoadBundledCedict() {
    state.importSummary = "Loading bundled CEDICT dictionary from assets/data/cedict_runtime.json...";
    renderImportStatus();

    return fetch(DEFAULT_CEDICT_PATH, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        const entries = payload && payload.entries ? payload.entries : [];
        const result = {
          entries: entries,
          totalCount: payload && payload.totalCount ? payload.totalCount : entries.length,
          wasCapped: payload && payload.totalCount ? payload.totalCount > entries.length : false
        };
        if (result.entries.length === 0) {
          throw new Error("No dictionary rows were parsed.");
        }

        state.vocab = preprocessVocabEntries(mergeById(state.vocab, result.entries));
        state.termIndex = buildTermIndex(state.vocab);
        ensureSelection();
        state.importSummary = buildCedictSummary(result, "Loaded bundled CEDICT.");
        render();
        return result;
      })
      .catch(function (error) {
        state.importSummary = "Bundled CEDICT could not be auto-loaded yet. You can still import the same file manually below.";
        renderImportStatus();
        throw error;
      });
  }

  function autoLoadBundledSentences() {
    state.importSummary = state.importSummary + " Loading bundled Tatoeba sentences from assets/data/tatoeba_runtime.json...";
    renderImportStatus();

    return fetch(DEFAULT_TATOEBA_PATH, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        const entries = payload && payload.entries ? payload.entries : [];
        const result = {
          entries: entries,
          totalCount: payload && payload.totalCount ? payload.totalCount : entries.length,
          wasCapped: payload && payload.totalCount ? payload.totalCount > entries.length : false
        };
        if (result.entries.length === 0) {
          throw new Error("No Tatoeba rows were parsed.");
        }

        state.sentences = preprocessSentenceEntries(mergeById(state.sentences, result.entries));
        state.importSummary = state.importSummary + " " + buildSentenceSummary(result, "Loaded bundled Tatoeba.");
        render();
        return result;
      })
      .catch(function () {
        state.importSummary = state.importSummary + " Bundled Tatoeba sentences could not be auto-loaded yet, but manual sentence import still works.";
        renderImportStatus();
        return null;
      });
  }

  function handleCedictImport(file) {
    if (!file) {
      return;
    }

    file.text().then(function (text) {
      const result = parseCedict(text, MAX_AUTO_CEDICT_ENTRIES);
      if (result.entries.length === 0) {
        state.importSummary = "No usable CEDICT rows were found in that file.";
        renderImportStatus();
        return;
      }

      state.vocab = preprocessVocabEntries(mergeById(state.vocab, result.entries));
      state.termIndex = buildTermIndex(state.vocab);
      ensureSelection();
      state.importSummary = buildCedictSummary(result, "Imported " + file.name + ".");
      saveImportedState();
      render();
    });
  }

  function handleSentenceImport(file) {
    if (!file) {
      return;
    }

    file.text().then(function (text) {
      const result = parseSentenceFile(text, state.vocab, MAX_AUTO_SENTENCE_ENTRIES);
      if (result.entries.length === 0) {
        state.importSummary = "The sentence file loaded, but no Chinese sentence rows were detected.";
        renderImportStatus();
        return;
      }

      state.sentences = preprocessSentenceEntries(mergeById(state.sentences, result.entries));
      state.importSummary = buildSentenceSummary(result, "Imported " + file.name + ".");
      saveImportedState();
      render();
    });
  }

  function saveImportedState() {
    const importedVocab = state.vocab.filter(function (term) {
      return !baseData.vocab.some(function (baseTerm) { return baseTerm.id === term.id; });
    });
    const importedSentencesOnly = state.sentences.filter(function (sentence) {
      return !baseData.sentences.some(function (baseSentence) { return baseSentence.id === sentence.id; });
    });
    const persistableVocab = importedVocab.length <= MAX_LOCAL_VOCAB_PERSIST ? importedVocab : [];
    const persistableSentences = importedSentencesOnly.length <= MAX_LOCAL_SENTENCE_PERSIST ? importedSentencesOnly : [];

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          vocab: persistableVocab,
          sentences: persistableSentences,
          summary: state.importSummary
        })
      );
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function parseCedict(rawText, maxEntries) {
    const entries = [];
    let totalCount = 0;
    const limit = typeof maxEntries === "number" ? maxEntries : MAX_AUTO_CEDICT_ENTRIES;

    rawText.split(/\r?\n/).forEach(function (line, index) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === "#") {
        return;
      }

      const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
      if (!match) {
        return;
      }

      totalCount += 1;
      if (entries.length >= limit) {
        return;
      }

      const traditional = match[1];
      const simplified = match[2];
      const pinyin = match[3];
      const definitions = match[4]
        .split("/")
        .filter(Boolean)
        .slice(0, 3)
        .join("; " );
      const englishKeywords = extractEnglishKeywords(match[4]);

      entries.push({
        id: "cedict-" + simplified + "-" + index,
        simplified: simplified,
        traditional: traditional,
        pinyin: pinyin,
        english: definitions || "Definition imported from CEDICT.",
        englishKeywords: englishKeywords,
        level: "Custom",
        memory: "Imported from CEDICT. Add a study prompt after reviewing how this word appears in context.",
        parts: splitParts(simplified)
      });
    });

    return {
      entries: entries,
      totalCount: totalCount,
      wasCapped: totalCount > entries.length
    };
  }

  function parseSentenceFile(rawText, vocabList, maxEntries) {
    const seen = {};
    const entries = [];
    let totalCount = 0;
    const limit = typeof maxEntries === "number" ? maxEntries : MAX_AUTO_SENTENCE_ENTRIES;
    const lines = rawText.split(/\r?\n/).filter(Boolean);

    lines.forEach(function (line, index) {
      const cells = line.indexOf("\t") !== -1 ? line.split("\t") : splitCsv(line);
      const normalizedCells = cells.map(function (cell) { return cell.trim(); }).filter(Boolean);
      if (normalizedCells.length === 0) {
        return;
      }

      let zh = "";
      let en = "";
      let pinyin = "";

      if (normalizedCells.length >= 3 && /^(cmn|zh|zho|yue|eng)$/i.test(normalizedCells[1])) {
        const language = normalizedCells[1].toLowerCase();
        const content = normalizedCells[2];
        if (isChineseLanguage(language) && containsHanzi(content)) {
          zh = content;
        } else if (language === "eng") {
          en = content;
        }
      } else {
        normalizedCells.forEach(function (cell) {
          if (!zh && containsHanzi(cell)) {
            zh = cell;
            return;
          }
          if (!pinyin && looksLikePinyin(cell)) {
            pinyin = cell;
            return;
          }
          if (!en && /[A-Za-z]/.test(cell) && !containsHanzi(cell)) {
            en = cell;
          }
        });
      }

      if (!zh || seen[zh]) {
        return;
      }

      seen[zh] = true;
      totalCount += 1;
      if (entries.length >= limit) {
        return;
      }

      entries.push({
        id: "sentence-import-" + index,
        zh: zh,
        pinyin: pinyin,
        en: en,
        termIds: collectMatchingTermIds(zh, vocabList)
      });
    });

    return {
      entries: entries,
      totalCount: totalCount,
      wasCapped: totalCount > entries.length
    };
  }

  function buildCedictSummary(result, prefix) {
    const capNote = result.wasCapped
      ? " Showing the first " + result.entries.length + " of " + result.totalCount + " entries to keep the browser fast."
      : " Loaded all " + result.entries.length + " entries.";

    return prefix + capNote;
  }

  function buildSentenceSummary(result, prefix) {
    const capNote = result.wasCapped
      ? " Showing the first " + result.entries.length + " of " + result.totalCount + " sentence rows to keep the browser fast."
      : " Loaded all " + result.entries.length + " sentence rows.";

    return prefix + capNote;
  }

  function ensureSelection() {
    if (!state.selectedTermId && state.vocab[0]) {
      state.selectedTermId = state.vocab[0].id;
    }

    if (!state.currentCardId && state.vocab[0]) {
      state.currentCardId = state.vocab[0].id;
    }
  }

  function collectMatchingTermIds(sentence, vocabList) {
    return vocabList
      .filter(function (term) {
        return sentence.indexOf(term.simplified) !== -1 || (term.traditional && sentence.indexOf(term.traditional) !== -1);
      })
      .slice(0, 6)
      .map(function (term) {
        return term.id;
      });
  }

  function splitParts(word) {
    return word.split("").map(function (char) {
      return {
        hanzi: char,
        note: "Imported character. Attach stroke-order JSON and mnemonic notes in the next pass."
      };
    });
  }

  function splitCsv(line) {
    const cells = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line.charAt(i);
      if (char === '"') {
        if (inQuotes && line.charAt(i + 1) === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        cells.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    cells.push(current);
    return cells;
  }

  function looksLikePinyin(value) {
    return /[1-5]/.test(value) && /[A-Za-z]/.test(value);
  }

  function termMatchesSearch(term, normalizedSearch) {
    const normalizedHanzi = term._searchHanzi || normalizeHanziText([term.simplified, term.traditional].join(" "));
    const normalizedPinyin = term._searchPinyin || normalizeSearchText(term.pinyin || "");
    const normalizedEnglish = term._searchEnglish || normalizeSearchText(term.english || "");
    const keywords = term._searchKeywords || getEnglishKeywords(term);

    return (
      normalizedHanzi.indexOf(normalizedSearch) !== -1 ||
      normalizedPinyin.indexOf(normalizedSearch) !== -1 ||
      normalizedEnglish.indexOf(normalizedSearch) !== -1 ||
      keywords.some(function (keyword) {
        return keyword.indexOf(normalizedSearch) !== -1;
      })
    );
  }

  function compareSearchRank(left, right, normalizedSearch) {
    const leftScore = getSearchPriorityScore(left, normalizedSearch);
    const rightScore = getSearchPriorityScore(right, normalizedSearch);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    const leftRank = rankSearchMatch(left, normalizedSearch);
    const rightRank = rankSearchMatch(right, normalizedSearch);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftLengthScore = getPreferredLengthScore(left);
    const rightLengthScore = getPreferredLengthScore(right);
    if (leftLengthScore !== rightLengthScore) {
      return leftLengthScore - rightLengthScore;
    }

    if ((left.english || "").length !== (right.english || "").length) {
      return (left.english || "").length - (right.english || "").length;
    }

    if (left.simplified.length !== right.simplified.length) {
      return left.simplified.length - right.simplified.length;
    }

    return left.simplified.localeCompare(right.simplified);
  }

  function getSearchPriorityScore(term, normalizedSearch) {
    let score = 0;
    const level = getHskLevel(term);
    const keywordList = term._searchKeywords || getEnglishKeywords(term);
    const fullEnglish = term._searchEnglish || normalizeSearchText(term.english || "");
    const charLength = (term.simplified || "").length;
    const rank = rankSearchMatch(term, normalizedSearch);

    if (/^HSK [1-3]$/i.test(level)) {
      score += 10000;
    } else if (/^HSK [4-6]$/i.test(level)) {
      score += 2500;
    }

    if (keywordList.some(function (keyword) { return keyword === normalizedSearch; })) {
      score += 5000;
    } else if (fullEnglish === normalizedSearch || fullEnglish === ("to " + normalizedSearch)) {
      score += 5000;
    }

    if (charLength <= 2) {
      score += 2000;
    } else if (charLength === 3) {
      score += 1200;
    } else {
      score += Math.max(0, 500 - (charLength * 60));
    }

    if (rank <= 1) {
      score += 1200;
    } else if (rank <= 3) {
      score += 700;
    }

    if (isRareTerm(term)) {
      score -= 4000;
    }

    return score;
  }

  function getPreferredLengthScore(term) {
    const length = (term.simplified || "").length;

    if (length === 2) {
      return 0;
    }

    if (length === 1) {
      return 1;
    }

    if (length === 3) {
      return 2;
    }

    return 3;
  }

  function isRareTerm(term) {
    return getDisplayLevel(term) === "Custom" && !getHskLevel(term);
  }

  function rankSearchMatch(term, normalizedSearch) {
    const keywords = term._searchKeywords || getEnglishKeywords(term);
    const fullEnglish = term._searchEnglish || normalizeSearchText(term.english || "");
    const simplified = normalizeHanziText(term.simplified || "");
    const traditional = normalizeHanziText(term.traditional || "");
    const pinyin = term._searchPinyin || normalizeSearchText(term.pinyin || "");

    if (simplified === normalizedSearch || traditional === normalizedSearch || pinyin === normalizedSearch) {
      return 0;
    }

    if (keywords.some(function (keyword) { return keyword === normalizedSearch; })) {
      return 1;
    }

    if (keywords.some(function (keyword) { return keyword.indexOf(normalizedSearch) === 0; })) {
      return 2;
    }

    if (fullEnglish.indexOf(normalizedSearch) === 0) {
      return 3;
    }

    if (keywords.some(function (keyword) { return keyword.indexOf(normalizedSearch) !== -1; })) {
      return 4;
    }

    if (fullEnglish.indexOf(normalizedSearch) !== -1) {
      return 5;
    }

    if (pinyin.indexOf(normalizedSearch) !== -1) {
      return 6;
    }

    return 7;
  }

  function getEnglishKeywords(term) {
    if (Array.isArray(term.englishKeywords) && term.englishKeywords.length > 0) {
      return term.englishKeywords.map(function (keyword) {
        return normalizeSearchText(keyword);
      }).filter(Boolean);
    }

    return extractEnglishKeywords(term.english || "");
  }

  function extractEnglishKeywords(rawEnglish) {
    return String(rawEnglish || "")
      .split(/[\/;]+/)
      .map(function (part) {
        return normalizeSearchText(
          part
            .replace(/^to\s+/, "")
            .replace(/^\([^)]*\)\s*/, "")
            .replace(/\([^)]*\)/g, " ")
        );
      })
      .filter(Boolean);
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[?']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeHanziText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function preprocessVocabEntries(entries) {
    return entries.map(function (term) {
      const nextTerm = Object.assign({}, term);
      nextTerm._searchHanzi = normalizeHanziText([nextTerm.simplified, nextTerm.traditional].join(" "));
      nextTerm._searchPinyin = normalizeSearchText(nextTerm.pinyin || "");
      nextTerm._searchEnglish = normalizeSearchText(nextTerm.english || "");
      nextTerm._searchKeywords = getEnglishKeywords(nextTerm);
      return nextTerm;
    });
  }

  function buildTermIndex(entries) {
    const index = {};

    entries.forEach(function (term) {
      [term.simplified, term.traditional].forEach(function (text) {
        const key = normalizeHanziText(text);
        if (!key) {
          return;
        }

        if (!index[key]) {
          index[key] = [];
        }

        if (!index[key].some(function (item) { return item.id === term.id; })) {
          index[key].push(term);
        }
      });
    });

    Object.keys(index).forEach(function (key) {
      index[key].sort(compareTermPreference);
    });

    return index;
  }

  function compareTermPreference(left, right) {
    const leftPriority = getLearnerPriorityScore(left);
    const rightPriority = getLearnerPriorityScore(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if ((left.simplified || "").length !== (right.simplified || "").length) {
      return (left.simplified || "").length - (right.simplified || "").length;
    }

    if ((left.english || "").length !== (right.english || "").length) {
      return (left.english || "").length - (right.english || "").length;
    }

    return (left.simplified || "").localeCompare(right.simplified || "");
  }

  function preprocessSentenceEntries(entries) {
    return entries.map(function (sentence) {
      const nextSentence = Object.assign({}, sentence);
      nextSentence._speakText = nextSentence.zh || "";
      return nextSentence;
    });
  }

  function getHskBadge(term) {
    const level = getHskLevel(term);
    if (!level) {
      return "";
    }

    return level.replace("HSK ", "HSK ");
  }

  function getHskLevel(term) {
    const simplifiedKey = normalizeHanziText(term.simplified || "");
    const traditionalKey = normalizeHanziText(term.traditional || "");
    const datasetLevel = state.hskLookup[simplifiedKey] || state.hskLookup[traditionalKey] || "";
    if (datasetLevel) {
      return datasetLevel;
    }

    const explicitLevel = String(term.level || "").trim();
    if (/^HSK [1-6]$/i.test(explicitLevel)) {
      return explicitLevel.toUpperCase();
    }

    return "";
  }

  function getDisplayLevel(term) {
    return getHskLevel(term) || String(term.level || "Custom").trim();
  }

  function getLearnerPriorityScore(term) {
    const level = getHskLevel(term);
    if (!level) {
      return 9;
    }

    const match = level.match(/HSK (\d)/i);
    return match ? Number(match[1]) : 9;
  }

  function containsHanzi(value) {
    return /[\u3400-\u9fff]/.test(value);
  }

  function isPureHanzi(value) {
    return /^[\u3400-\u9fff]+$/.test(String(value || ""));
  }

  function isChineseLanguage(language) {
    return language === "cmn" || language === "zh" || language === "zho" || language === "yue";
  }

  function loadImportedData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { vocab: [], sentences: [], summary: "" };
    } catch (error) {
      return { vocab: [], sentences: [], summary: "" };
    }
  }

  function mergeById(baseList, additions) {
    const map = {};
    const merged = [];

    baseList.concat(additions || []).forEach(function (item) {
      if (!item || !item.id || map[item.id]) {
        return;
      }
      map[item.id] = true;
      merged.push(item);
    });

    return merged;
  }

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}());
