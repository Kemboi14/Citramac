import { describe, expect, it } from "vitest";
import { ApiError } from "./apiClient";
import { fieldErrorsFrom, formErrorSummary } from "./formErrors";

describe("form error helpers", () => {
  it("flattens nested API validation errors into dot-separated field names", () => {
    const error = new ApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "org_admin: [object Object]",
        fields: {
          org_admin: {
            email: ["A user with this email already exists."],
          },
          name: ["This field is required."],
        },
      },
    });

    expect(fieldErrorsFrom(error)).toEqual({
      "org_admin.email": "A user with this email already exists.",
      name: "This field is required.",
    });
  });

  it("uses a summary when all validation errors are shown inline", () => {
    const error = new ApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "slug: An organization with this slug already exists.",
        fields: { slug: ["An organization with this slug already exists."] },
      },
    });

    expect(formErrorSummary(error, "Couldn't save.", ["slug"])).toBe(
      "Some answers need attention — see the highlighted fields.",
    );
  });
});
