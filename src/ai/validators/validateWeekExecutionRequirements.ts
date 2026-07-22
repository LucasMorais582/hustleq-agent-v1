export function validateWeekExecutionRequirements(
  executionRequirements: any
) {
  if (!executionRequirements) {
    console.log("Invalid execution requirements: object is undefined");
    return false;
  }

  /*
    REQUIRED FIELDS
  */

    if (typeof executionRequirements.summary !== "string" || !executionRequirements.summary.trim()) {
        console.log("Invalid execution requirements: missing summary");
        return false;
    }

    if (executionRequirements.summary.trim().length < 20) {
        console.log("Invalid execution requirements: summary is too short");
        return false;
    }

  const arrayFields = [
    "requirements",
    "assets",
    "people",
    "locations",
    "importantNotes",
  ];

    /*
        ARRAY VALIDATION
    */

    for (const field of arrayFields) {
        if (!Array.isArray(executionRequirements[field])) {
            console.log(`Invalid execution requirements: ${field} is not an array`);
            return false;
        }
    }

    /*
        STRING VALIDATION
    */

    for (const field of arrayFields) {
        for (const item of executionRequirements[field]) {
            if (typeof item !== "string" || !item.trim()) {
                console.log(`Invalid execution requirements: invalid item found in ${field}`);
                return false;
            }
        }
    }

    /*
        DUPLICATE VALIDATION
    */

    for (const field of arrayFields) {
        const normalized = executionRequirements[field].map((item: string) =>
            item.trim().toLowerCase()
        );

        if (new Set(normalized).size !== normalized.length) {
            console.log(`Invalid execution requirements: duplicated values detected in ${field}`);
            return false;
        }
    }
    console.log("Week execution requirements validation passed");

    return true;
}