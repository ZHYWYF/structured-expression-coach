import proofMark from "../../assets/app-icon.svg?raw";

/** 静态本地母版直接内联；不加载图片、字体或用户提供的 SVG。 */
export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-symbol ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: proofMark }} />;
}
