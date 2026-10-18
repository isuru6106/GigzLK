"""Verify host-side Kafka delivery using an existing test topic."""

import time
import uuid

from confluent_kafka import Consumer, KafkaException, Producer


def main():
    broker = "127.0.0.1:9092"
    topic = "gigzlk.test.events.v1"
    marker = f"gigzlk-host-test-{uuid.uuid4()}".encode()
    delivery = []

    def on_delivery(error, message):
        delivery.append(error)
        if error is None:
            print(
                f"Delivered: partition={message.partition()}, "
                f"offset={message.offset()}"
            )

    producer = Producer({
        "bootstrap.servers": broker,
        "client.id": "gigzlk-host-smoke-producer",
        "message.timeout.ms": 15000,
        "acks": "all",
    })

    producer.produce(topic, key=marker, value=marker, on_delivery=on_delivery)

    remaining = producer.flush(20)
    if remaining or not delivery:
        raise RuntimeError("Timed out waiting for delivery confirmation.")
    if delivery[0] is not None:
        raise KafkaException(delivery[0])

    consumer = Consumer({
        "bootstrap.servers": broker,
        "group.id": f"gigzlk-smoke-{uuid.uuid4()}",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "allow.auto.create.topics": False,
    })

    try:
        consumer.subscribe([topic])
        deadline = time.monotonic() + 30

        while time.monotonic() < deadline:
            message = consumer.poll(1.0)
            if message is None:
                continue
            if message.error():
                raise KafkaException(message.error())
            if message.value() == marker:
                print("PASS: Windows produced and consumed the unique test message.")
                return

        raise RuntimeError("Timed out waiting for the matching test message.")
    finally:
        consumer.close()


if __name__ == "__main__":
    main()
