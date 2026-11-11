import { parseLessonBody } from "./lesson-markdown";

const inline = (text: string) =>
  text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .map((part, index) =>
      part.startsWith("**") && part.length > 4 ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.length > 2 ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );

export function LessonBody({ body }: { body: string }) {
  return (
    <div className="lesson-body">
      {parseLessonBody(body).map((block, index) => {
        if (block.type === "heading") {
          // The page already has its h1 (course) and h2 (lesson): lesson headings start at h3.
          const Tag = `h${block.level + 2}` as "h3" | "h4" | "h5";
          return <Tag key={index}>{inline(block.text)}</Tag>;
        }
        if (block.type === "code")
          return (
            <pre key={index} tabIndex={0}>
              <code>{block.text}</code>
            </pre>
          );
        if (block.type === "quote")
          return <blockquote key={index}>{inline(block.text)}</blockquote>;
        if (!("items" in block)) return <p key={index}>{inline(block.text)}</p>;
        const List = block.type;
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
