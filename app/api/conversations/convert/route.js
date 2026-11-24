import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { createOpportunityFromConversation } from "../../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";

export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const body = await jsonBody(request);
    return Response.json(
      await createOpportunityFromConversation(user, body.conversation_id, body.data),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
