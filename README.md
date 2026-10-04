# usage-deck

A Claude Code mod that puts your plan limits, context fill and prompt-cache warmth in one compact deck above the prompt, with an animated Clawd that reacts to what Claude is doing.

```
 [Clawd]   5-HOUR                 WEEKLY                 CONTEXT
           ⣿⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒  07%    ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠒  93%    ⣿⣿⠒⠒⠒⠒⠒⠒⠒⠒⠒⠒  09%
           resets in 1h56m        resets in 1d19h        93k of 1M · cache 100%  warm 60m
```

## What it shows

- **5-hour and weekly limits** with reset countdowns. A window that just reset shows as `new window` instead of vanishing.
- **Context fill** with tokens used out of the window.
- **Prompt-cache warmth:** the share of the last turn served from cache, and a countdown until the cache goes cold (green, then yellow under 15 minutes, red under 5). Send something before it hits red and the next turn doesn't pay to rebuild the cache.
- **Clawd** types while tools run, thinks when a turn goes quiet, bounces when it finishes, looks around and yawns when idle, and dozes after 10 minutes.

The deck drops to one row while a turn runs, and steps aside when another mod draws in the same band (image previews, for example).

## Install

Requires Claude Code 2.1.287 or later (mods are on by default).

```
/plugin marketplace add codeclawd/usage-deck
/plugin install usage-deck@usage-deck
/reload-plugins
```

`/deck` hides or shows it.

## Notes

- The cache countdown assumes the 1-hour prompt-cache TTL. Sessions on the 5-minute TTL will see it count down from 60.
- Limits come from the usage Claude Code reports after each turn, refreshed once a minute.

## License

MIT
