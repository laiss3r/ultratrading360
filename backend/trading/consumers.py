"""
WebSocket consumers.

Push live bot status and trade events to the frontend so a page refresh or a dropped WS connection
does not lose state: on reconnect the client re-reads authoritative state from the REST API, and
the socket only carries incremental updates. The database is the source of truth, never the socket.
"""

from __future__ import annotations

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import BotRun, Trade

logger = logging.getLogger(__name__)


def bot_group(run_id: str) -> str:
    return f"bot.{run_id}"


def user_group(user_id) -> str:
    return f"user.{user_id}"


class BotConsumer(AsyncJsonWebsocketConsumer):
    """Streams status and trade events for one bot run."""

    async def connect(self):
        self.run_id = self.scope["url_route"]["kwargs"]["run_id"]
        user = self.scope.get("user")
        if user is None or not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return
        # Ownership is checked before joining the group: without this, knowing a run id would be
        # enough to watch somebody else's trades.
        allowed = await self._may_access(user, self.run_id)
        if not allowed:
            await self.close(code=4403)
            return
        await self.channel_layer.group_add(bot_group(self.run_id), self.channel_name)
        await self.accept()
        await self.send_json({"type": "subscribed", "run_id": self.run_id})

    @database_sync_to_async
    def _may_access(self, user, run_id: str) -> bool:
        return BotRun.objects.filter(pk=run_id, owner=user).exists()

    async def disconnect(self, code):
        if hasattr(self, "run_id"):
            await self.channel_layer.group_discard(bot_group(self.run_id), self.channel_name)

    async def bot_status(self, event):
        await self.send_json(event["payload"])

    async def bot_trade(self, event):
        await self.send_json(event["payload"])


class UserConsumer(AsyncJsonWebsocketConsumer):
    """Streams this user's aggregate activity: bot starts/stops and trade settlements."""

    async def connect(self):
        user = self.scope.get("user")
        if user is None or not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return
        self.group = user_group(user.pk)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()
        # On connect, replay authoritative state so a reconnecting client is immediately correct.
        state = await self._snapshot(user)
        await self.send_json({"type": "snapshot", **state})

    @database_sync_to_async
    def _snapshot(self, user) -> dict:
        runs = BotRun.objects.for_user(user).filter(status__in=BotRun.ACTIVE_STATUSES)
        return {
            "active_bots": [
                {"id": r.id, "strategy": r.strategy.name, "status": r.status, "mode": r.mode,
                 "trades": r.trades_count, "net_profit": float(r.net_profit)}
                for r in runs
            ],
            "recent_trades": [
                {"id": t.id, "symbol": t.symbol, "profit": float(t.profit), "won": t.won,
                 "source": t.source, "settled": t.is_settled}
                for t in Trade.objects.for_user(user)[:25]
            ],
        }

    async def disconnect(self, code):
        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def bot_status(self, event):
        await self.send_json(event["payload"])

    async def bot_trade(self, event):
        await self.send_json(event["payload"])


async def broadcast_trade(user_id, trade: dict) -> None:
    """Publish a settled trade to a user's group. Safe to call when no one is listening."""
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    await layer.group_send(user_group(user_id), {"type": "bot.trade", "payload": {"type": "trade", **trade}})


async def broadcast_status(user_id, run_id: str, payload: dict) -> None:
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    await layer.group_send(user_group(user_id), {"type": "bot.status", "payload": {"type": "status", "run_id": run_id, **payload}})
    await layer.group_send(bot_group(run_id), {"type": "bot.status", "payload": {"type": "status", "run_id": run_id, **payload}})
