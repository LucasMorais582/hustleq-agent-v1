function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
}

function extractKeywords(text: string) {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length > 4);
}

export function validateWeekBlueprint(
  blueprint: any
) {
  if (!blueprint?.blueprint) {
    console.log(
      "Invalid blueprint: missing blueprint array"
    );

    return false;
  }

  const concepts =
    blueprint.blueprint.map(
      (item: any) =>
        item.concept || ""
    );

  const allWords: string[] = [];

  for (const concept of concepts) {
    const words =
      extractKeywords(concept);

    allWords.push(...words);
  }

  /*
    Count repeated words
  */

  const frequency: Record<
    string,
    number
  > = {};

  for (const word of allWords) {
    frequency[word] =
      (frequency[word] || 0) + 1;
  }

  /*
    Detect excessive repetition
  */

  const repeatedWords =
    Object.entries(frequency)
      .filter(
        ([_, count]) =>
          count >= 5
      );

  if (repeatedWords.length > 0) {
    console.log(
      "Invalid blueprint: repetitive concepts detected"
    );

    console.log(
      repeatedWords
    );

    return false;
  }

  console.log(
    "Blueprint validation passed"
  );

  return true;
}