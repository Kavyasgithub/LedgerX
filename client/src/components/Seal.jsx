import React, { useEffect, useRef } from "react";
import { money } from "../api.js";

export default function Seal({ globalSum }) {
  const ref = useRef(null);
  const prev = useRef(globalSum);

  useEffect(() => {
    if (globalSum !== 0 && globalSum != null && prev.current !== globalSum && ref.current) {
      ref.current.classList.remove("flash");
      void ref.current.offsetWidth;
      ref.current.classList.add("flash");
    }
    prev.current = globalSum;
  }, [globalSum]);

  const unknown = globalSum == null;
  const broken = !unknown && globalSum !== 0;

  return (
    <div
      ref={ref}
      className={`seal ${broken ? "broken" : ""} ${unknown ? "stale" : ""}`}
    >
      <div className="label">Sum of every posting</div>
      <div className="num">{unknown ? "—" : money(globalSum)}</div>
      <div className="state">
        {unknown ? "Awaiting the API" : broken ? "Money has gone missing" : "Balanced"}
      </div>
    </div>
  );
}
