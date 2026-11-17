export function validateWeekPipeline(
  week: any,
  planConfig: any
) {
  if (!week) {
    console.log(
      "Invalid week: week is undefined"
    );
    return false;
  }

  /*
    QUANTITY VALIDATION
  */

  if (
    week.staticPosts?.length !==
    planConfig.staticPerWeek
  ) {
    console.log(
      "Invalid week: wrong static posts quantity"
    );
    return false;
  }

  if (
    week.dynamicPosts?.length !==
    planConfig.dynamicPerWeek
  ) {
    console.log(
      "Invalid week: wrong dynamic posts quantity"
    );
    return false;
  }

  if (
    week.stories?.length !==
    planConfig.storiesPerWeek
  ) {
    console.log(
      "Invalid week: wrong stories quantity"
    );
    return false;
  }

  /*
    FLATTEN POSTS
  */

  const allPosts = [
    ...(week.staticPosts || []),
    ...(week.dynamicPosts || []),
    ...(week.stories || []),
  ];

  /*
    EMPTY POSTS
  */

  for (const post of allPosts) {
    if (!post) {
      console.log(
        "Invalid week: undefined post found"
      );
      return false;
    }
  }

  /*
    REQUIRED FIELDS
  */

  for (const post of allPosts) {
    if (!post.idea) {
      console.log(
        "Invalid week: missing idea"
      );
      return false;
    }

    if (post.contentType !== "story" && !post.caption) {
      console.log(
        "Invalid week: missing caption"
      );
      return false;
    }

    if (!post.productionGuidance) {
      console.log(
        "Invalid week: missing productionGuidance"
      );
      return false;
    }

    if (!post.creativeDirection) {
      console.log(
        "Invalid week: missing creativeDirection"
      );
      return false;
    }
  }

  /*
    DUPLICATED TITLES
  */

  const titles = allPosts.map(
    (post) =>
      post.idea?.title
        ?.trim()
        .toLowerCase()
  );

  const uniqueTitles =
    new Set(titles);

  if (
    uniqueTitles.size !==
    titles.length
  ) {
    console.log(
      "Invalid week: duplicated titles detected"
    );
    return false;
  }

  console.log(
    "Week pipeline validation passed"
  );

  return true;
}