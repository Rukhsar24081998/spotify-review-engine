const WEIGHTS = {
  keyword: 2.0,
  tokenOverlap: 1.0,
  synonym: 1.0,
  phrase: 1.5,
  stem: 0.75
};

const RETRIEVAL = { targetMin: 10, targetMax: 12, minimum: 8 };

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .filter(function(token) { return token.length >= 3; });
}

function uniqueTokens(tokens) {
  return Array.from(new Set(tokens));
}

function stem(token) {
  var word = token.toLowerCase();
  var suffixes = ['ation', 'ment', 'ingly', 'edly', 'ing', 'ed', 'es', 'ly', 's'];
  for (var i = 0; i < suffixes.length; i++) {
    var suffix = suffixes[i];
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  return word.length >= 3 ? word : token.toLowerCase();
}

function bigrams(text) {
  var tokens = tokenize(text);
  var pairs = [];
  for (var i = 0; i < tokens.length - 1; i++) {
    pairs.push(tokens[i] + ' ' + tokens[i + 1]);
  }
  return pairs;
}

function jaccard(setA, setB) {
  if (!setA.length || !setB.length) return 0;
  var a = new Set(setA);
  var b = new Set(setB);
  var intersection = 0;
  a.forEach(function(item) {
    if (b.has(item)) intersection++;
  });
  var union = new Set(setA.concat(setB)).size;
  return union ? intersection / union : 0;
}

function countMatches(text, patterns) {
  var hits = 0;
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) hits++;
  }
  return hits;
}

function buildBucket(config) {
  var anchorTokens = uniqueTokens(
    config.strongKeywords
      .concat(config.weakKeywords)
      .concat(Object.keys(config.synonyms))
      .concat(Object.values(config.synonyms).flat())
      .join(' ')
  );

  return {
    id: config.id,
    strongPatterns: config.strongKeywords.map(function(term) {
      return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i');
    }),
    weakPatterns: config.weakKeywords.map(function(term) {
      return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i');
    }),
    anchorTokens: anchorTokens,
    anchorStems: uniqueTokens(anchorTokens.map(stem)),
    anchorPhrases: config.anchorPhrases,
    synonyms: config.synonyms
  };
}

var BUCKET_CONFIGS = [
  {
    id: 'discovery',
    strongKeywords: ['discover weekly', 'new music', 'find new', 'music discovery', 'hidden gem', 'comfort zone'],
    weakKeywords: ['discover', 'explore', 'fresh', 'stale', 'new artist', 'tiktok', 'instagram', 'social discovery'],
    anchorPhrases: ['discover new music', 'find new artists', 'discover weekly', 'comfort zone', 'same songs'],
    synonyms: {
      discover: ['find', 'explore', 'uncover', 'surface'],
      stale: ['stuck', 'recycled', 'repetitive', 'same'],
      algorithm: ['recommendation', 'feed', 'suggestions']
    }
  },
  {
    id: 'recommendations',
    strongKeywords: ['smart shuffle', 'discover weekly', 'daily mix', 'release radar', 'for you', 'same artist'],
    weakKeywords: ['recommend', 'algorithm', 'suggest', 'personaliz', 'radio', 'shuffle', 'trust', 'transparen', 'recycled'],
    anchorPhrases: ['smart shuffle', 'discover weekly', 'same songs', 'recommendation engine', 'daily mix'],
    synonyms: {
      recommend: ['suggest', 'surface', 'feed', 'push'],
      algorithm: ['engine', 'recommendation', 'personalization'],
      shuffle: ['random', 'mix', 'rotation']
    }
  },
  {
    id: 'listeningBehaviour',
    strongKeywords: ['daily mix', 'smart shuffle', 'android auto', 'offline mode', 'liked songs'],
    weakKeywords: ['mood', 'playlist', 'queue', 'shuffle', 'podcast', 'offline', 'download', 'vibe', 'session', 'listen'],
    anchorPhrases: ['listening session', 'my playlist', 'mood based', 'queue management', 'offline listening'],
    synonyms: {
      playlist: ['queue', 'library', 'collection'],
      mood: ['vibe', 'context', 'activity', 'moment'],
      shuffle: ['mix', 'radio', 'autoplay']
    }
  },
  {
    id: 'repetitiveListening',
    strongKeywords: ['same song', 'same songs', 'over and over', 'again and again', 'same track'],
    weakKeywords: ['repeat', 'loop', 'recycle', 'rotation', 'stuck', 'familiar', 'shuffle', 'playlist'],
    anchorPhrases: ['same songs over and over', 'hearing the same', 'repeat the same', 'playlist is long'],
    synonyms: {
      repeat: ['loop', 'recycle', 'rotation', 'again'],
      stuck: ['same', 'familiar', 'safe'],
      shuffle: ['random', 'mix']
    }
  },
  {
    id: 'userSegments',
    strongKeywords: ['free version', 'free user', 'family plan', 'without premium', 'paying for premium'],
    weakKeywords: ['premium', 'free tier', 'subscriber', 'mobile', 'desktop', 'tablet', 'android auto', 'paid'],
    anchorPhrases: ['free version', 'premium user', 'without premium', 'mobile version', 'family plan'],
    synonyms: {
      premium: ['paid', 'subscriber', 'subscription'],
      free: ['non premium', 'without premium', 'free tier'],
      mobile: ['phone', 'android', 'ios']
    }
  },
  {
    id: 'productOpportunities',
    strongKeywords: ['dislike button', 'unmet need', 'wish they', 'would like', 'please add'],
    weakKeywords: ['unmet', 'need', 'wish', 'want', 'missing', 'lack', 'should', 'feature', 'control', 'transparen'],
    anchorPhrases: ['wish they would', 'would like', 'unmet need', 'missing feature', 'need a way'],
    synonyms: {
      wish: ['want', 'need', 'would like', 'hope'],
      missing: ['lack', 'without', 'no way to'],
      control: ['choose', 'filter', 'skip', 'curate']
    }
  }
];

var BUCKETS = BUCKET_CONFIGS.map(buildBucket);

function keywordScore(normalizedText, bucket) {
  var strongHits = countMatches(normalizedText, bucket.strongPatterns);
  var weakHits = countMatches(normalizedText, bucket.weakPatterns);
  var raw = (strongHits * 3) + weakHits;
  return Math.min(raw / 6, 1);
}

function tokenOverlapScore(reviewTokens, bucket) {
  return jaccard(reviewTokens, bucket.anchorTokens);
}

function synonymScore(normalizedText, bucket) {
  var hits = 0;
  Object.keys(bucket.synonyms).forEach(function(canonical) {
    var forms = [canonical].concat(bucket.synonyms[canonical]);
    for (var i = 0; i < forms.length; i++) {
      if (normalizedText.indexOf(normalizeText(forms[i])) !== -1) {
        hits++;
        break;
      }
    }
  });
  return Math.min(hits / 4, 1);
}

function stemScore(reviewTokens, bucket) {
  var reviewStems = uniqueTokens(reviewTokens.map(stem));
  var intersection = 0;
  var stemSet = new Set(bucket.anchorStems);
  reviewStems.forEach(function(item) {
    if (stemSet.has(item)) intersection++;
  });
  return Math.min(intersection / 5, 1);
}

function phraseScore(normalizedText, bucket) {
  var best = 0;
  bucket.anchorPhrases.forEach(function(phrase) {
    var phraseBigrams = bigrams(phrase);
    if (!phraseBigrams.length) return;
    var reviewBigrams = bigrams(normalizedText);
    var overlap = 0;
    var phraseSet = new Set(phraseBigrams);
    reviewBigrams.forEach(function(item) {
      if (phraseSet.has(item)) overlap++;
    });
    best = Math.max(best, overlap / phraseBigrams.length);
  });
  return best;
}

function scoreReview(review, bucket) {
  var normalizedText = normalizeText(review.source + ' ' + review.review);
  var reviewTokens = uniqueTokens(tokenize(normalizedText));

  return (
    keywordScore(normalizedText, bucket) * WEIGHTS.keyword +
    tokenOverlapScore(reviewTokens, bucket) * WEIGHTS.tokenOverlap +
    synonymScore(normalizedText, bucket) * WEIGHTS.synonym +
    phraseScore(normalizedText, bucket) * WEIGHTS.phrase +
    stemScore(reviewTokens, bucket) * WEIGHTS.stem
  );
}

function retrieveForBucket(reviews, bucketId) {
  var bucket = BUCKETS.find(function(item) { return item.id === bucketId; });
  if (!bucket) return reviews.slice(0, RETRIEVAL.minimum);

  var scored = reviews
    .map(function(review, index) {
      return { review: review, score: scoreReview(review, bucket), index: index };
    })
    .sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  var positive = scored.filter(function(item) { return item.score > 0; });
  var selected = positive.slice(0, RETRIEVAL.targetMax);

  if (selected.length < RETRIEVAL.targetMin) {
    scored.forEach(function(item) {
      if (selected.length >= RETRIEVAL.targetMin) return;
      if (selected.some(function(existing) { return existing.index === item.index; })) return;
      selected.push(item);
    });
  }

  while (selected.length < RETRIEVAL.minimum) {
    var added = false;
    for (var i = 0; i < scored.length; i++) {
      if (selected.some(function(existing) { return existing.index === scored[i].index; })) continue;
      selected.push(scored[i]);
      added = true;
      break;
    }
    if (!added) break;
  }

  return selected.slice(0, RETRIEVAL.targetMax).map(function(item) { return item.review; });
}

export { BUCKETS, RETRIEVAL, retrieveForBucket, scoreReview };
